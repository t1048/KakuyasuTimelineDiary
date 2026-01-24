# Cloudflare移行ガイド

このドキュメントは、KakuyasuTimelineDiaryをAWSからCloudflareインフラへ移行するための手順を説明します。

## 前提条件

- Cloudflareアカウント（無料プランで可）
- Node.js 18以降
- AWS Cognito（認証は継続使用）

## セットアップ手順

### 0. AWS Cognito のデプロイ (事前準備)

Cloudflare の設定に必要な Cognito 情報を取得するため、先に AWS CDK で認証基盤をデプロイします。

```bash
# 仮想環境の有効化 (Windows)
. .venv\Scripts\Activate.ps1

# CDK デプロイ
cdk deploy
```

デプロイ完了後、ターミナルに表示される `Outputs` の値をメモしてください：
- `GekiyasuDiaryCdkPyStack.UserPoolId`
- `GekiyasuDiaryCdkPyStack.UserPoolClientId`

### 1. Wranglerのインストール

```bash
cd web-app
npm install
```

### 2. Cloudflareへログイン

```bash
npx wrangler login
```

ブラウザでCloudflareへログインし、認証を完了します。

### 3. D1データベース作成

```bash
npx wrangler d1 create kakuyasu-timeline-diary-db
```

出力された`database_id`をコピーして、[wrangler.toml](web-app/wrangler.toml:11)の`database_id`フィールドに貼り付けます。

```toml
[[d1_databases]]
binding = "DB"
database_name = "kakuyasu-timeline-diary-db"
database_id = "ここにdatabase_idを貼り付け"
```

### 4. D1マイグレーション実行

```bash
# ローカル開発用
npx wrangler d1 execute kakuyasu-timeline-diary-db `
  --local `
  --file=./migrations/0001_initial_schema.sql

# 本番環境用
npx wrangler d1 execute kakuyasu-timeline-diary-db `
  --remote `
  --file=./migrations/0001_initial_schema.sql
```

### 5. R2バケット作成

```bash
npx wrangler r2 bucket create kakuyasu-timeline-user-content
```

### 6. 環境変数設定

[wrangler.toml](web-app/wrangler.toml:19)を編集して、ステップ0で取得したCognito情報を設定します:

```toml
[vars]
AWS_REGION = "ap-northeast-1"
USER_POOL_ID = "ap-northeast-1_XXXXXXXXX"  # GekiyasuDiaryCdkPyStack.UserPoolId の値
USER_POOL_CLIENT_ID = "XXXXXXXXXXXXXXXXXXXXXXXXXX"  # GekiyasuDiaryCdkPyStack.UserPoolClientId の値
CONSENT_VERSION = "2025-12-21"
MONTHLY_IMAGE_UPLOAD_LIMIT = "50"
```

### 7. フロントエンド環境変数設定

`.env`ファイルを作成（または`.env.example`をコピー）:

```bash
cp .env.example .env
```

`.env`を編集し、ステップ0で取得した値を設定します:

```
VITE_API_URL=
VITE_USER_POOL_ID=ap-northeast-1_XXXXXXXXX
VITE_USER_POOL_CLIENT_ID=XXXXXXXXXXXXXXXXXXXXXXXXXX
VITE_REGION=ap-northeast-1
VITE_R2_DOMAIN=
```

### 8. ローカルテスト

```bash
# ビルド
npm run build

# Wranglerローカルサーバー起動
npx wrangler pages dev dist --live-reload
```

ブラウザで `http://localhost:8788` を開いてテストします。

### 9. 本番デプロイ

```bash
# ビルド
npm run build

# Cloudflare Pagesへデプロイ
npx wrangler pages deploy dist --project-name=kakuyasu-timeline-diary
```

デプロイが完了すると、CloudflareからURLが発行されます（例: `https://kakuyasu-timeline-diary.pages.dev`）。

### 10. R2公開URL設定（オプション）

R2バケットのマネージド公開URL (`r2.dev`) を有効にします：

1. Cloudflareダッシュボードで **R2** > **kakuyasu-timeline-user-content** を選択します。
2. **Settings** タブを開き、**Public Bucket UI** セクションを探します。
3. **Allow Access** をクリックし、確認画面で `Confirm` 等を入力して有効化します。
4. 発行されたURL（例: `https://pub-xxxx.r2.dev`）をコピーします。

`.env`の`VITE_R2_DOMAIN`にこのURLを設定して再デプロイします：

```bash
# ビルド
npm run build

# 再デプロイ
npx wrangler pages deploy dist --project-name=kakuyasu-timeline-diary
```

---

## CI/CD設定（GitHub Actions）

### 必要なシークレット

GitHub リポジトリの Settings > Secrets and variables > Actions で以下を設定:

- `CLOUDFLARE_API_TOKEN`: Cloudflareダッシュボードから取得（My Profile > API Tokens > Create Token）
  - Permissions: `Account.Cloudflare Pages:Edit`, `Account.D1:Edit`
- `CLOUDFLARE_ACCOUNT_ID`: Cloudflareダッシュボードの右サイドバーに表示
- `VITE_USER_POOL_ID`: AWS Cognito User Pool ID
- `VITE_USER_POOL_CLIENT_ID`: AWS Cognito Client ID
- `VITE_REGION`: `ap-northeast-1`
- `VITE_R2_DOMAIN`: R2公開ドメイン（オプション）

設定後、`main`ブランチへのpushで自動デプロイされます。

---

## アーキテクチャ変更点

### 移行前（AWS）
- **API**: API Gateway (HTTP API)
- **Backend**: Lambda (Python 3.11)
- **Database**: DynamoDB
- **Storage**: S3
- **CDN**: CloudFront
- **IaC**: AWS CDK (Python)

### 移行後（Cloudflare）
- **API**: Pages Functions (同一オリジン)
- **Backend**: TypeScript Functions
- **Database**: D1 (SQLite)
- **Storage**: R2
- **CDN**: Cloudflare CDN（自動）
- **IaC**: Wrangler (wrangler.toml)

### 変更なし
- **認証**: AWS Cognito（JWT）
- **フロントエンド**: React + Vite
- **暗号化**: クライアント側AES-GCM

---

## トラブルシューティング

### D1マイグレーションエラー

```bash
# エラー: table already exists
# → マイグレーションは既に実行済み（無視してOK）
```

### JWT認証エラー

- `wrangler.toml`の`USER_POOL_ID`と`USER_POOL_CLIENT_ID`が正しいか確認
- Cognitoのアプリクライアント設定で「アクセストークン」が有効か確認

### R2アップロードエラー

```bash
# R2バケットが作成されているか確認
npx wrangler r2 bucket list
```

### ローカル開発でCORSエラー

- `_middleware.ts`でCORSヘッダーが正しく設定されているか確認
- ブラウザのDevToolsでネットワークタブを確認

---

## データ移行（本番データがある場合）

既存のDynamoDB/S3データを移行する場合:

### DynamoDB → D1

1. DynamoDBからエクスポート:
```bash
aws dynamodb export-table-to-point-in-time \
  --table-arn arn:aws:dynamodb:REGION:ACCOUNT:table/KakuyasuTimelineDiary \
  --s3-bucket kakuyasu-migration-export \
  --export-format DYNAMODB_JSON
```

2. 変換スクリプト実行（別途作成が必要）

3. D1へインポート:
```bash
npx wrangler d1 execute kakuyasu-timeline-diary-db \
  --remote \
  --file=./migration-data/import.sql
```

### S3 → R2

rcloneを使用:

```bash
rclone sync s3:kakuyasu-timeline-user-content \
  cloudflare:kakuyasu-timeline-user-content \
  --progress \
  --checksum
```

---

## コスト比較

### AWS（従来）
- DynamoDB: ~$0-5/月（オンデマンド）
- Lambda: ~$0-5/月
- S3 + CloudFront: ~$1-10/月
- **合計**: $1-20/月

### Cloudflare（移行後）
- Pages: 無料（500ビルド/月まで）
- D1: 無料（5GB、500万読み取り/日まで）
- R2: 無料（10GB、1,000万読み取り/月まで）
- **合計**: $0/月（無料枠内）

---

## サポート

問題が発生した場合:

1. [Cloudflare Docs](https://developers.cloudflare.com/)を確認
2. `wrangler tail`でリアルタイムログを確認:
   ```bash
   npx wrangler pages deployment tail
   ```
3. GitHubでIssueを作成

---

## 次のステップ

移行完了後:

1. ✅ 動作確認（日記作成、画像アップロード、削除）
2. ✅ パフォーマンステスト
3. ⏳ AWSリソース削除（移行が成功したら）
   ```bash
   cd gekiyasu_diary_cdk_py
   cdk destroy
   ```

Happy Migrating! 🚀
