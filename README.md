# 激安日記アプリ（AWS CDK / Python）

個人向けの「日記 + 予定」アプリです。AWSへ **低コスト** でデプロイして運用できます。

- バックエンド：API Gateway + Lambda（Python）+ DynamoDB
- 認証：Cognito User Pool（※セルフサインアップ無効／管理者作成のみ）
- フロント：Vite + React（S3 + CloudFront 配信）

## 💰 コスト比較

| コンポーネント | サーバーレス（本プロジェクト） | EC2 + VPC + RDS |
|---|---|---|
| **コンピュート** | Lambda：$0.20/100万リクエスト | EC2（t3.micro）：$7.50/月（常時稼働） |
| **データベース** | DynamoDB：$1.25/GB（オンデマンド） | RDS（db.t3.micro）：$20-30/月 |
| **ネットワーク** | API Gateway：$3.50/100万リクエスト | 別途 NAT ゲートウェイ費用 |
| **ストレージ** | S3 + CloudFront：$0.50/GB（転送） | EBS：$0.10/GB/月 |
| **想定月額（低利用）** | **$1-5/月** | **$30-50/月** |
| **想定月額（中程度利用）** | **$10-20/月** | **$30-50/月** |

✅ **サーバーレスが **10～50倍安い** です！**

### 📊 アーキテクチャ移行の目安

以下のような規模に成長した場合、**EC2 + RDS への移行** を検討してください：

- **ユーザー数：100人以上**
- **月間 API リクエスト数：1,000万リクエスト以上**
- **データベース容量：10GB以上**
- **同時接続数：500以上**

この規模では、EC2 + RDS のほうが **スケーラビリティ・運用効率** で優位になる場合があります。  
ただし、本プロジェクトは **個人～小規模チーム向け** のため、現在のサーバーレス構成がお勧めです。

---

## 📌 まずはこちら（詳しいデプロイ手順）

デプロイ手順の詳細は `デプロイ手順書.md` にまとめています。

- [デプロイ手順書.md](./デプロイ手順書.md)

この README では、**誰でもデプロイできるように**「AWS側の準備」「ローカルのインストール」「認証設定」までを案内します。

---

## ✅ 前提

- AWSアカウントを作成できること（クレジットカード登録が必要です）
- ローカルPCでコマンド実行できること（macOS / Windows / Linux）

## 0) このリポジトリを取得

このプロジェクト（`gekiyasu-diary-cdk-py`）をローカルに配置してください（Git clone / ZIP ダウンロード等）。

## 1) AWSアカウント作成

まだの場合は AWS アカウントを作成してください。

- https://aws.amazon.com/jp/ （「アカウントを作成」）

作成後、**請求アラート（Budgets）** の設定を推奨します（想定外の課金防止）。

## 2) CDKデプロイ用 IAM ユーザー（またはロール）作成

最短で進めるため、ここでは IAM ユーザー + アクセスキーでの手順を記載します。

1. AWSコンソール → IAM → ユーザー → 「ユーザーを追加」
2. アクセスキーを発行（AWSコンソールの案内に従って作成）
3. 権限は以下いずれかを付与
   - 簡単に進める：`AdministratorAccess`（個人検証用途向け）
   - 運用で厳密にする：最小権限ポリシーを用意（※本READMEでは割愛）
4. 発行された `Access key ID` / `Secret access key` を控える

> 可能であれば MFA 有効化、不要になったキーの削除も推奨です。

## 3) ローカル環境のインストール

以下が必要です。

- AWS CLI（`aws --version`）
- Node.js（CDK CLI / フロントビルド用）
- Python（CDKアプリ実行用。本プロジェクトは `python3.11` を使用）
- AWS CDK CLI（`cdk --version`）

### AWS CLI

- 公式手順：https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html

### Node.js

- 公式：https://nodejs.org/ （LTS推奨）

### Python

- 公式：https://www.python.org/downloads/

### AWS CDK CLI（グローバルインストール）

```
npm install -g aws-cdk
cdk --version
```

## 4) AWS認証情報の設定（`aws configure`）

作成した IAM ユーザーのアクセスキーをローカルに設定します。

```
aws configure
```

入力例：

- AWS Access Key ID: （控えた値）
- AWS Secret Access Key: （控えた値）
- Default region name: `ap-northeast-1`（例）
- Default output format: `json`

設定できたか確認：

```
aws sts get-caller-identity
```

アカウントIDの確認（`cdk bootstrap aws://ACCOUNT_ID/REGION` で使います）：

```
aws sts get-caller-identity --query Account --output text
```

> 複数アカウント/複数ユーザーを使い分けたい場合は、`AWS_PROFILE` を使う運用が便利です（例：`AWS_PROFILE=your-profile cdk deploy`）。

## 5) CDK（Python）依存関係のセットアップ

```
cd gekiyasu-diary-cdk-py
python3 -m venv .venv  # Windows は `python -m venv .venv`
source .venv/bin/activate  # Windows は `.\.venv\Scripts\activate`
pip install -r requirements.txt
```

## 6) デプロイ（初回は bootstrap が必要）

以降の流れは `デプロイ手順書.md` に沿って実施してください。

- [デプロイ手順書.md](./デプロイ手順書.md)

ポイントだけ抜粋すると以下です。

1. `cdk bootstrap`（アカウント/リージョンごとに一度だけ）
2. `cdk deploy`（1回目）→ Outputs から `ApiUrl` / `UserPoolId` / `UserPoolClientId` を取得
3. `web-app/.env.example` を `web-app/.env` にコピーして `VITE_API_URL` / `VITE_USER_POOL_ID` / `VITE_USER_POOL_CLIENT_ID` を設定
4. `web-app` を `npm run build`
5. `cdk deploy`（2回目）→ `CloudFrontUrl` でアクセス

## 注意事項

- `cdk destroy` はリソース削除により **保存データも消える** 可能性があります（テーブル等が `DESTROY` 設定）。
- Cognito はセルフサインアップ無効のため、初回は管理者がユーザー作成してください（手順は `デプロイ手順書.md` に記載）。

---

## ☕ サポート
このアプリが気に入っていただけたら、ぜひサポートをお願いします！  
いただいたご支援は、制作者の糧となり活力になります。


[![Support on Ko-fi](https://img.shields.io/badge/Support%20on%20Ko--fi-FF5E5B?style=for-the-badge&logo=kofi&logoColor=white)](https://ko-fi.com/t1048)

---
