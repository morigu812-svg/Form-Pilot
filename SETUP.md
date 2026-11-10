# FormPilot セットアップ

GitHub Pagesは main ブランチのルートを公開します。

1. Google Cloudでテスト用プロジェクトを作り、Google Forms API、Google Drive API、Google Sheets APIを有効にします。
2. Google Auth Platformで外部向けのテストアプリを設定し、利用するGoogleアカウントをテストユーザーに追加します。
3. ウェブアプリ用OAuthクライアントを作成し、承認済みのJavaScript生成元に https://morigu812-svg.github.io を追加します。公開用Client IDを config.js の clientId に設定します。
4. 既存フォームを取り込む場合は、同じプロジェクトでGoogle Picker APIを有効にします。Google Picker APIと公開サイトのHTTPリファラーに制限したキーを pickerKey に、プロジェクト番号を projectNumber に設定します。
5. ページを開き、別々のテストアカウントで所有者の分離を確認します。テストフォームで作成、編集、受付、回答表示、ゴミ箱移動、管理台帳更新を確認します。

Googleのアクセストークンはページのメモリに保持します。フォーム、回答、管理台帳の実データはGoogle側に保存されます。管理台帳の先頭タブのA〜C列は「管理台帳を更新」で置き換わります。回答はアプリ内で閲覧できます。Google Forms標準の回答シート接続はGoogle Forms側で設定します。
