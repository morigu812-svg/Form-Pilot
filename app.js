import { clientId, pickerKey, projectNumber } from './config.js';

const $ = id => document.getElementById(id);
const drive = 'https://www.googleapis.com/drive/v3';
const forms = 'https://forms.googleapis.com/v1/forms';
const sheets = 'https://sheets.googleapis.com/v4/spreadsheets';
const scope = 'openid email https://www.googleapis.com/auth/drive.file';
const mime = 'application/vnd.google-apps.form';
const fields = 'id,name,mimeType,trashed,ownedByMe,capabilities(canEdit,canTrash,canShare),appProperties,parents,modifiedTime';
let session;
let current;
let questions = [];
let page;
let busy = false;

async function api(s, url, method = 'GET', body) {
  if (s !== session) throw new Error('Googleに再接続してください。');
  if (Date.now() >= s.expires) throw new Error('接続の期限が切れました。Googleに再接続してください。');
  const headers = { Authorization: 'Bearer ' + s.token };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(url, { method, headers, body: JSON.stringify(body), credentials: 'omit' });
  if (s !== session) throw new Error('接続が切り替わりました。');
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    const message = response.status === 401 ? 'Googleに再接続してください。'
      : response.status === 429 ? '利用上限に達しました。しばらく待ってからやり直してください。'
      : error.error?.message || 'Google APIの操作に失敗しました。';
    throw new Error(message);
  }
  return response.status === 204 ? null : response.json();
}

function url(base, params) {
  return base + '?' + new URLSearchParams(params);
}

function status(message) { $('status').textContent = message; }

async function run(action) {
  if (busy) return;
  busy = true;
  $('dashboard').inert = true;
  $('detail').inert = true;
  status('処理中…');
  try {
    status(await action() || '');
  } catch (error) {
    status(error.message);
  } finally {
    busy = false;
    $('dashboard').inert = false;
    $('detail').inert = false;
  }
}

function clear() {
  session = undefined;
  current = undefined;
  questions = [];
  page = undefined;
  for (const id of ['account', 'forms', 'items', 'answer-list']) $(id).replaceChildren();
  for (const id of ['title', 'description']) $(id).value = '';
  for (const id of ['dashboard', 'detail', 'disconnect', 'ledger-link']) $(id).hidden = true;
}

function connect() {
  if (busy) return;
  if (!clientId) return status('OAuthクライアントIDを config.js に設定してください。');
  if (!window.google?.accounts?.oauth2) return status('Googleの認証機能を読み込めませんでした。');
  const oauth = google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope,
    include_granted_scopes: false,
    error_callback: () => status('Googleの接続画面が閉じられました。'),
    callback: result => run(async () => {
      if (result.error || !google.accounts.oauth2.hasGrantedAllScopes(result, scope.split(' ').at(-1))) {
        throw new Error('Google Driveのファイル権限が必要です。');
      }
      clear();
      const s = { token: result.access_token, expires: Date.now() + Number(result.expires_in) * 1000 };
      session = s;
      try {
        const user = await api(s, 'https://openidconnect.googleapis.com/v1/userinfo');
        s.sub = user.sub;
        $('account').textContent = user.email || 'Googleアカウントに接続済み';
        $('disconnect').hidden = false;
        $('dashboard').hidden = false;
      } catch (error) {
        clear();
        throw error;
      }
      await list(s);
    })
  });
  oauth.requestAccessToken({ prompt: 'select_account' });
}

async function files(s, query) {
  const result = [];
  let token;
  do {
    const params = { q: "'me' in owners and trashed=false and " + query, fields: 'nextPageToken,files(' + fields + ')' };
    if (token) params.pageToken = token;
    const data = await api(s, url(drive + '/files', params));
    result.push(...(data.files || []));
    token = data.nextPageToken;
  } while (token);
  return result;
}

const tag = value => "appProperties has { key='formPilot' and value='" + value + "' }";
const formUrl = id => forms + '/' + encodeURIComponent(id);
const fileUrl = id => drive + '/files/' + encodeURIComponent(id);

async function owned(s, id, capability = 'canEdit') {
  const file = await api(s, url(fileUrl(id), { fields }));
  if (!file.ownedByMe || file.trashed || file.mimeType !== mime || !file.capabilities?.[capability]) {
    throw new Error('自分が所有し、この操作を許可されたフォームを選んでください。');
  }
  return file;
}

async function list(s) {
  const entries = await files(s, tag('form') + " and mimeType='" + mime + "'");
  entries.sort((a, b) => (b.modifiedTime || '').localeCompare(a.modifiedTime || ''));
  $('count').textContent = '(' + entries.length + '件)';
  $('forms').replaceChildren(...entries.map(file => {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.textContent = file.name;
    button.onclick = () => run(() => open(s, file.id));
    item.append(button);
    return item;
  }));
  return entries;
}

async function folder(s) {
  const found = await files(s, tag('folder') + " and mimeType='application/vnd.google-apps.folder'");
  if (found.length) return found[0].id;
  const file = await api(s, drive + '/files', 'POST', {
    name: 'FormPilot', mimeType: 'application/vnd.google-apps.folder', appProperties: { formPilot: 'folder' }
  });
  return file.id;
}

async function register(s, id, parent) {
  const file = await owned(s, id);
  const params = { fields };
  if (parent && !file.parents?.includes(parent)) {
    params.addParents = parent;
    if (file.parents?.length) params.removeParents = file.parents.join(',');
  }
  await api(s, url(fileUrl(id), params), 'PATCH', { appProperties: { formPilot: 'form' } });
}

async function open(s, id) {
  await owned(s, id);
  const data = await api(s, formUrl(id));
  current = data;
  $('detail').hidden = false;
  $('title').value = data.info.title;
  $('description').value = data.info.description || '';
  $('native').href = 'https://docs.google.com/forms/d/' + encodeURIComponent(id) + '/edit';
  const responder = data.responderUri && new URL(data.responderUri);
  $('responder').hidden = responder?.origin !== 'https://docs.google.com';
  if (!$('responder').hidden) $('responder').href = responder.href;
  const publication = data.publishSettings?.publishState;
  $('publication').textContent = !publication ? '旧形式のフォームです。受付設定はGoogle Formsで変更してください。'
    : publication.isAcceptingResponses ? '受付中' : publication.isPublished ? '公開・受付停止' : '非公開';
  for (const id of ['start', 'stop', 'unpublish', 'sharing']) $(id).disabled = !publication;
  $('answer-list').hidden = true;
  $('answer-list').textContent = '';
  $('more').hidden = true;
  page = undefined;
  questions = (data.items || []).map(item => ({ item }));
  renderQuestions();
}

function button(label, callback) {
  const element = document.createElement('button');
  element.type = 'button';
  element.textContent = label;
  element.onclick = callback;
  return element;
}

function control(container, label, element) {
  const wrapper = document.createElement('label');
  wrapper.append(label, element);
  container.append(wrapper);
}

function renderQuestions() {
  $('items').replaceChildren(...questions.map((entry, index) => {
    const row = document.createElement('fieldset');
    const legend = document.createElement('legend');
    legend.textContent = '項目 ' + (index + 1);
    row.append(legend);
    const item = entry.item;
    const question = item.questionItem?.question;
    if (!entry.item.itemId || question?.textQuestion || ['RADIO', 'CHECKBOX', 'DROP_DOWN'].includes(question?.choiceQuestion?.type)) {
      const title = document.createElement('input');
      title.value = item.title || '';
      title.required = true;
      title.oninput = () => { entry.title = title.value; };
      if (entry.title !== undefined) title.value = entry.title;
      control(row, '質問文', title);
      const required = document.createElement('input');
      required.type = 'checkbox';
      required.checked = entry.required ?? question?.required ?? false;
      required.onchange = () => { entry.required = required.checked; };
      control(row, '必須', required);
      if (!item.itemId) {
        const type = document.createElement('select');
        for (const [value, label] of [['short', '記述式'], ['long', '段落'], ['RADIO', 'ラジオボタン'], ['CHECKBOX', 'チェックボックス'], ['DROP_DOWN', 'プルダウン']]) {
          type.add(new Option(label, value));
        }
        type.value = entry.type || 'short';
        type.onchange = () => { entry.type = type.value; renderQuestions(); };
        control(row, '種類', type);
        if (!['short', 'long'].includes(type.value)) {
          const options = document.createElement('textarea');
          options.required = true;
          options.value = entry.options || '';
          options.oninput = () => { entry.options = options.value; };
          control(row, '選択肢（1行に1件）', options);
        }
      } else if (question.choiceQuestion) {
        const choice = question.choiceQuestion;
        if (choice.options.every(option => option.value && Object.keys(option).length === 1)) {
          const options = document.createElement('textarea');
          options.required = true;
          options.value = entry.options ?? choice.options.map(option => option.value).join('\n');
          options.oninput = () => { entry.options = options.value; };
          control(row, '選択肢（1行に1件）', options);
        }
      }
      row.append(button('質問を削除', () => {
        if (item.itemId && !confirm('既存の質問を削除しますか？ 保存すると反映されます。')) return;
        questions.splice(index, 1);
        renderQuestions();
      }));
    } else {
      const text = document.createElement('p');
      text.textContent = (item.title || '無題') + '（この項目はGoogle Formsで編集できます）';
      row.append(text);
    }
    return row;
  }));
}

function choices(value) {
  const options = value.trim().split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (!options.length || new Set(options).size !== options.length) {
    throw new Error('重複しない選択肢を入力してください。');
  }
  return options.map(value => ({ value }));
}

async function save(s) {
  const form = current;
  if (!form.revisionId) throw new Error('リビジョンを取得できません。フォームを開き直してください。');
  await owned(s, form.formId);
  const title = $('title').value.trim();
  if (!title) throw new Error('タイトルを入力してください。');
  const requests = [{ updateFormInfo: {
    info: { title, description: $('description').value }, updateMask: 'title,description'
  } }];
  const kept = new Set(questions.map(entry => entry.item.itemId));
  const original = form.items || [];
  for (let index = original.length - 1; index >= 0; index--) {
    if (!kept.has(original[index].itemId)) requests.push({ deleteItem: { location: { index } } });
  }
  questions.forEach((entry, index) => {
    const item = structuredClone(entry.item);
    if (item.itemId) {
      const mask = [];
      if (entry.title !== undefined) { item.title = entry.title.trim(); mask.push('title'); }
      if (entry.required !== undefined) {
        item.questionItem.question.required = entry.required;
        mask.push('questionItem.question.required');
      }
      if (entry.options !== undefined) {
        item.questionItem.question.choiceQuestion.options = choices(entry.options);
        mask.push('questionItem.question.choiceQuestion.options');
      }
      if (mask.length) {
        if (!item.title) throw new Error('質問文を入力してください。');
        requests.push({ updateItem: { item, location: { index }, updateMask: mask.join(',') } });
      }
    } else {
      if (!entry.title?.trim()) throw new Error('質問文を入力してください。');
      const type = entry.type || 'short';
      const question = { required: entry.required || false };
      if (type === 'short' || type === 'long') question.textQuestion = { paragraph: type === 'long' };
      else question.choiceQuestion = { type, options: choices(entry.options || '') };
      requests.push({ createItem: { item: { title: entry.title.trim(), questionItem: { question } }, location: { index } } });
    }
  });
  await api(s, formUrl(form.formId) + ':batchUpdate', 'POST', {
    requests, writeControl: { requiredRevisionId: form.revisionId }
  });
  await open(s, form.formId);
  return '保存しました。';
}

async function publish(isPublished, isAcceptingResponses) {
  const s = session;
  const id = current.formId;
  await owned(s, id);
  await api(s, formUrl(id) + ':setPublishSettings', 'POST', {
    publishSettings: { publishState: { isPublished, isAcceptingResponses } }
  });
  await open(s, id);
  return '受付設定を更新しました。';
}

async function sharing() {
  const s = session;
  const id = current.formId;
  await owned(s, id, 'canShare');
  const endpoint = fileUrl(id) + '/permissions';
  let token;
  let existing;
  do {
    const params = { includePermissionsForView: 'published', fields: 'nextPageToken,permissions(id,view,role,type)' };
    if (token) params.pageToken = token;
    const data = await api(s, url(endpoint, params));
    existing = data.permissions?.find(p => p.view === 'published' && p.role === 'reader' && p.type === 'anyone');
    token = data.nextPageToken;
  } while (token && !existing);
  if (existing) {
    if (!confirm('リンクを知っている全員への回答権限を取り消しますか？')) return;
    await api(s, endpoint + '/' + encodeURIComponent(existing.id), 'DELETE');
  } else {
    if (!confirm('リンクを知っている全員に、このフォームへの回答を許可しますか？')) return;
    await api(s, endpoint, 'POST', { type: 'anyone', role: 'reader', view: 'published' });
  }
  return '回答者の共有権限を更新しました。';
}

async function responses(next) {
  const s = session;
  const id = current.formId;
  await owned(s, id);
  const params = { pageSize: 25 };
  if (next && page) params.pageToken = page;
  const data = await api(s, url(formUrl(id) + '/responses', params));
  const labels = new Map((current.items || []).flatMap(item => {
    const question = item.questionItem?.question;
    if (question) return [[question.questionId, item.title]];
    return (item.questionGroupItem?.questions || []).map(q => [q.questionId, q.rowQuestion?.title || item.title]);
  }));
  const rows = (data.responses || []).map(response => {
    const answers = Object.entries(response.answers || {}).map(([id, answer]) => {
      const values = answer.textAnswers?.answers?.map(a => a.value)
        ?? answer.fileUploadAnswers?.answers?.map(a => a.fileName)
        ?? [];
      return (labels.get(id) || id) + '：' + values.join('、');
    });
    return [new Date(response.lastSubmittedTime).toLocaleString('ja-JP'), ...answers].join('\n');
  });
  page = data.nextPageToken;
  $('answer-list').textContent = rows.join('\n\n') || '回答はありません。';
  $('answer-list').hidden = false;
  $('more').hidden = !page;
}

async function ledger() {
  const s = session;
  const entries = await list(s);
  const parent = await folder(s);
  const found = await files(s, tag('ledger') + " and mimeType='application/vnd.google-apps.spreadsheet'");
  let id = found[0]?.id;
  if (!id) {
    const file = await api(s, drive + '/files', 'POST', {
      name: 'FormPilot 管理台帳',
      mimeType: 'application/vnd.google-apps.spreadsheet',
      parents: [parent],
      appProperties: { formPilot: 'ledger' }
    });
    id = file.id;
  }
  const endpoint = sheets + '/' + encodeURIComponent(id);
  const book = await api(s, url(endpoint, { fields: 'sheets(properties(sheetId,gridProperties))' }));
  const tab = book.sheets[0].properties;
  const values = [['フォームID', 'Drive上の名前', '最終更新日時'], ...entries.map(file => [file.id, file.name, file.modifiedTime || ''])];
  const requests = [];
  if (values.length > tab.gridProperties.rowCount) {
    requests.push({ appendDimension: { sheetId: tab.sheetId, dimension: 'ROWS', length: values.length - tab.gridProperties.rowCount } });
  }
  requests.push({ updateCells: {
    range: { sheetId: tab.sheetId, startRowIndex: 0, startColumnIndex: 0, endColumnIndex: 3 },
    rows: values.map(row => ({ values: row.map(stringValue => ({ userEnteredValue: { stringValue } })) })),
    fields: 'userEnteredValue'
  } });
  await api(s, endpoint + ':batchUpdate', 'POST', { requests });
  $('ledger-link').href = 'https://docs.google.com/spreadsheets/d/' + encodeURIComponent(id) + '/edit';
  $('ledger-link').hidden = false;
  return '管理台帳を更新しました。';
}

function importForm() {
  const s = session;
  if (!pickerKey || !projectNumber) return status('Google Pickerのキーとプロジェクト番号を設定してください。');
  if (!window.gapi) return status('Google Pickerを読み込めませんでした。');
  if (Date.now() >= s.expires) return status('Googleに再接続してください。');
  gapi.load('picker', () => {
    if (session !== s) return;
    const view = new google.picker.DocsView().setMimeTypes(mime);
    new google.picker.PickerBuilder().addView(view).setOAuthToken(s.token)
      .setDeveloperKey(pickerKey).setAppId(projectNumber).setOrigin(location.origin)
      .setCallback(data => {
        if (session !== s || data.action !== google.picker.Action.PICKED) return;
        run(async () => {
          const id = data.docs[0].id;
          await register(s, id);
          await list(s);
          await open(s, id);
          return '既存フォームを登録しました。';
        });
      }).build().setVisible(true);
  });
}

$('connect').onclick = connect;
$('disconnect').onclick = () => { clear(); $('ledger-link').hidden = true; status('ログアウトしました。'); };
$('refresh').onclick = () => run(async () => { await list(session); });
$('import').onclick = importForm;
$('ledger').onclick = () => run(ledger);
$('create').onsubmit = event => {
  event.preventDefault();
  run(async () => {
    const s = session;
    const title = new FormData(document.getElementById('create')).get('title').trim();
    if (!title) throw new Error('フォーム名を入力してください。');
    const parent = await folder(s);
    let form;
    try {
      form = await api(s, url(forms, { unpublished: true }), 'POST', { info: { title } });
    } catch (error) {
      throw new Error(error.message + ' 再作成する前にGoogle Driveで作成済みか確認してください。');
    }
    try {
      await register(s, form.formId, parent);
    } catch (error) {
      throw new Error(error.message + ' 作成済みフォームを「Driveから取り込む」で登録してください。ID ' + form.formId);
    }
    $('create').reset();
    await list(s);
    await open(s, form.formId);
    return '非公開のフォームを作成しました。';
  });
};
$('edit').onsubmit = event => { event.preventDefault(); run(() => save(session)); };
$('add').onclick = () => { questions.push({ item: {} }); renderQuestions(); };
$('start').onclick = () => run(() => publish(true, true));
$('stop').onclick = () => run(() => publish(true, false));
$('unpublish').onclick = () => run(() => publish(false, false));
$('sharing').onclick = () => run(sharing);
$('trash').onclick = () => run(async () => {
  const s = session;
  const id = current.formId;
  if (!confirm('フォームをGoogle Driveのゴミ箱に移動しますか？')) return;
  await owned(s, id, 'canTrash');
  await api(s, fileUrl(id), 'PATCH', { trashed: true });
  current = undefined;
  $('detail').hidden = true;
  await list(s);
  return 'ゴミ箱に移動しました。';
});
$('responses').onclick = () => run(() => responses(false));
$('more').onclick = () => run(() => responses(true));

