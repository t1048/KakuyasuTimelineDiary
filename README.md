# 激安日記アプリ（Cloudflare + AWS Cognito）

個人向けの「日記 + 予定」アプリです。**完全無料枠内**で運用できます。

## 🚀 アーキテクチャ

### フロントエンド・バックエンド
- **Cloudflare Pages**: フロントエンド（React + Vite）+ API（TypeScript Functions）
- **Cloudflare D1**: データベース（SQLite）
- **Cloudflare R2**: 画像ストレージ

### 認証
- **AWS Cognito User Pool**: ユーザー認証（※セルフサインアップ無効／管理者作成のみ）

---

## 💰 コスト比較

| アーキテクチャ | 月額コスト（個人利用） | 備考 |
|---|---|---|
| **Cloudflare（本プロジェクト）** | **$0/月** | Pages, D1, R2すべて無料枠内 |
| **従来のAWSサーバーレス** | $1-20/月 | Lambda + DynamoDB + S3 + CloudFront |
| **EC2 + RDS** | $30-50/月 | 常時稼働のサーバー費用 |

### ✅ Cloudflare無料枠の詳細

| サービス | 無料枠 | 個人利用の目安 |
|---|---|---|
| **Pages** | 500ビルド/月 | 毎日デプロイしても余裕 |
| **D1** | 5GB、500万読み取り/日 | 数年分の日記データを保存可能 |
| **R2** | 10GB、1,000万読み取り/月 | 画像数千枚を保存可能 |
| **Cognito** | MAU 50,000まで無料 | 個人・小規模利用は完全無料 |

**結論: 個人利用なら完全無料で運用可能！** 🎉

---

## 📌 デプロイ手順

### クイックスタート

1. **Cloudflareへの移行**: [CLOUDFLARE_MIGRATION.md](./CLOUDFLARE_MIGRATION.md) を参照
2. **AWS Cognito設定**: 本READMEの「Cognito設定」セクション

詳細な手順は以下のドキュメントをご覧ください：

- **Cloudflare移行ガイド**: [CLOUDFLARE_MIGRATION.md](./CLOUDFLARE_MIGRATION.md)
- **従来のデプロイ手順** (参考): [デプロイ手順書.md](./デプロイ手順書.md)

---

## ✅ 前提条件

### 必須
- **Cloudflareアカウント**（無料プラン）
- **AWSアカウント**（Cognito用のみ）
- Node.js 18以降
- Git

### ローカル開発用（オプション）
- AWS CLI（Cognito管理用）
- Python 3.11（AWS CDK用）

---

## 🔧 セットアップ手順

### 1. リポジトリのクローン

```bash
git clone <このリポジトリのURL>
cd KakuyasuTimelineDiary
```

### 2. Cloudflare Pagesへのデプロイ

詳細は [CLOUDFLARE_MIGRATION.md](./CLOUDFLARE_MIGRATION.md) を参照してください。

**概要**:

```bash
cd web-app

# 1. 依存関係インストール
npm install

# 2. Wranglerでログイン
npx wrangler login

# 3. D1データベース作成
npx wrangler d1 create kakuyasu-timeline-diary-db

# 4. R2バケット作成
npx wrangler r2 bucket create kakuyasu-timeline-user-content

# 5. 環境変数設定（wrangler.tomlを編集）

# 6. D1マイグレーション
npx wrangler d1 execute kakuyasu-timeline-diary-db \
  --remote \
  --file=./migrations/0001_initial_schema.sql

# 7. ビルド＆デプロイ
npm run build
npx wrangler pages deploy dist --project-name=kakuyasu-timeline-diary
```

### 3. AWS Cognito設定

Cognitoはユーザー認証専用で使用します。

#### 3.1 AWS CDKでCognitoをデプロイ

```bash
# リポジトリルートで実行

# Python仮想環境作成
python3 -m venv .venv
source .venv/bin/activate  # Windows: .\.venv\Scripts\activate

# 依存関係インストール
pip install -r requirements.txt

# Bootstrapアカウント（初回のみ）
cdk bootstrap aws://YOUR_ACCOUNT_ID/ap-northeast-1

# Cognitoスタックをデプロイ
cdk deploy
```

デプロイ後、以下の情報が出力されます：
- `UserPoolId`
- `UserPoolClientId`
- `Region`

#### 3.2 環境変数の設定

上記の値を `web-app/wrangler.toml` に設定：

```toml
[vars]
AWS_REGION = "ap-northeast-1"
USER_POOL_ID = "ap-northeast-1_XXXXXXXXX"
USER_POOL_CLIENT_ID = "XXXXXXXXXXXXXXXXXXXXXXXXXX"
```

再デプロイ：

```bash
cd web-app
npm run build
npx wrangler pages deploy dist --project-name=kakuyasu-timeline-diary
```

#### 3.3 ユーザー作成

Cognitoはセルフサインアップ無効のため、管理者が手動でユーザーを作成します。

**AWS CLIの場合**:

```bash
aws cognito-idp admin-create-user \
  --user-pool-id ap-northeast-1_XXXXXXXXX \
  --username user@example.com \
  --user-attributes Name=email,Value=user@example.com \
  --region ap-northeast-1
```

**AWSコンソールの場合**:
1. Cognito → User Pools → kakuyasu-timeline-diary-user-pool
2. Users → Create user
3. メールアドレスを入力
4. 一時パスワードが自動生成される

初回ログイン時に、ユーザーはパスワードを変更するよう求められます。

---

## 🏗️ プロジェクト構成

```
KakuyasuTimelineDiary/
├── web-app/                      # フロントエンド + Cloudflare Functions
│   ├── src/                      # Reactアプリ
│   ├── functions/                # Cloudflare Pages Functions (TypeScript)
│   │   ├── _middleware.ts        # JWT認証ミドルウェア
│   │   ├── items.ts              # 日記CRUD API
│   │   ├── consent.ts            # 同意管理API
│   │   ├── upload-url.ts         # 画像アップロードAPI
│   │   └── api/upload/[key].ts   # R2アップロードプロキシ
│   ├── migrations/               # D1データベースマイグレーション
│   │   └── 0001_initial_schema.sql
│   ├── wrangler.toml             # Cloudflare設定
│   └── package.json
├── gekiyasu_diary_cdk_py/        # AWS CDK (Cognito専用)
│   └── gekiyasu_diary_cdk_py_stack.py
├── app.py                        # CDKエントリーポイント
├── requirements.txt              # Python依存関係
├── CLOUDFLARE_MIGRATION.md       # Cloudflare移行ガイド
└── README.md                     # このファイル
```

---

## 🔐 セキュリティ

- **認証**: AWS Cognito JWT
- **暗号化**: クライアント側AES-GCM（4桁PIN）
- **CORS**: 適切に設定済み
- **アップロード制限**: 月間50枚/ユーザー

---

## 📊 機能

- ✅ 日記の作成・編集・削除
- ✅ 予定・イベントの管理
- ✅ 画像アップロード（暗号化）
- ✅ タグ機能
- ✅ 複数日にまたがるイベント
- ✅ オフライン同期キュー
- ✅ テンプレート機能
- ✅ 定期予定機能

---

## 🛠️ 開発

### ローカル開発

```bash
cd web-app

# D1ローカルマイグレーション
npx wrangler d1 execute kakuyasu-timeline-diary-db \
  --local \
  --file=./migrations/0001_initial_schema.sql

# ローカルサーバー起動
npm run build
npx wrangler pages dev dist --live-reload
```

ブラウザで `http://localhost:8788` を開きます。

### CI/CD

GitHub Actionsで自動デプロイ設定済み（`.github/workflows/deploy.yml`）。

必要なシークレット：
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `VITE_USER_POOL_ID`
- `VITE_USER_POOL_CLIENT_ID`

---

## 📝 移行履歴

このプロジェクトは以下の順で進化しました：

1. **v1.0**: AWS完全サーバーレス（Lambda + DynamoDB + S3 + CloudFront）
2. **v2.0**: Cloudflare移行（Pages + D1 + R2）
3. **v2.1**: AWS CDK簡素化（Cognito専用スタック）

コスト削減効果：**月額$1-20 → $0**

詳細は [CLOUDFLARE_MIGRATION.md](./CLOUDFLARE_MIGRATION.md) をご覧ください。

---

## 🗑️ リソースの削除

### Cloudflareリソース

```bash
# Pagesプロジェクト削除（Cloudflareダッシュボードから手動）
# D1データベース削除
npx wrangler d1 delete kakuyasu-timeline-diary-db

# R2バケット削除
npx wrangler r2 bucket delete kakuyasu-timeline-user-content
```

### AWS Cognito削除

```bash
cdk destroy
```

**警告**: `cdk destroy`を実行すると、すべてのユーザーデータが削除されます。

---

## 🐛 トラブルシューティング

### JWT認証エラー

- `wrangler.toml`の`USER_POOL_ID`と`USER_POOL_CLIENT_ID`を確認
- Cognitoのアプリクライアント設定を確認

### R2アップロードエラー

```bash
# R2バケットが存在するか確認
npx wrangler r2 bucket list
```

### D1マイグレーションエラー

```bash
# テーブルが既に存在する場合は無視してOK
npx wrangler d1 execute kakuyasu-timeline-diary-db \
  --remote \
  --command "SELECT name FROM sqlite_master WHERE type='table';"
```

---

## 📚 参考リンク

- [Cloudflare Pages Docs](https://developers.cloudflare.com/pages/)
- [Cloudflare D1 Docs](https://developers.cloudflare.com/d1/)
- [Cloudflare R2 Docs](https://developers.cloudflare.com/r2/)
- [AWS Cognito Docs](https://docs.aws.amazon.com/cognito/)
- [AWS CDK Docs](https://docs.aws.amazon.com/cdk/)

---

## ☕ サポート

このアプリが気に入っていただけたら、ぜひサポートをお願いします！
いただいたご支援は、制作者の糧となり活力になります。

[![Support on Ko-fi](https://img.shields.io/badge/Support%20on%20Ko--fi-FF5E5B?style=for-the-badge&logo=kofi&logoColor=white)](https://ko-fi.com/t1048)

---

## 📄 ライセンス

このプロジェクトは個人利用・学習目的でご自由にお使いください。
