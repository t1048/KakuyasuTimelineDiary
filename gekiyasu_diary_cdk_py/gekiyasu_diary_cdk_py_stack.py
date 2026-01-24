from aws_cdk import (
    Stack,
    RemovalPolicy,
    CfnOutput,
    aws_cognito as cognito,
)
from constructs import Construct


class GekiyasuDiaryCdkPyStack(Stack):

    def __init__(self, scope: Construct, construct_id: str, **kwargs) -> None:
        super().__init__(scope, construct_id, **kwargs)

        # Cognito User Pool
        user_pool = cognito.UserPool(
            self, "KakuyasuTimelineUserPool",
            user_pool_name="kakuyasu-timeline-diary-user-pool",
            # セルフサインアップを無効化し、メールまたは電話番号で登録可能
            self_sign_up_enabled=False,
            sign_in_aliases=cognito.SignInAliases(
                email=True,
                phone=True
            ),
            # ユーザー検証の設定（コード方式）
            user_verification=cognito.UserVerificationConfig(
                email_style=cognito.VerificationEmailStyle.CODE,
                sms_message="Your Kakuyasu Timeline Diary code is {####}",
            ),
            removal_policy=RemovalPolicy.DESTROY,
        )

        # User Pool Client
        user_pool_client = user_pool.add_client(
            "KakuyasuTimelineUserPoolClient",
            user_pool_client_name="web-app-client",
            auth_flows=cognito.AuthFlow(
                user_srp=True,
                user_password=True
            ),
        )

        # Admin Create User Configuration
        cfn_user_pool = user_pool.node.default_child
        cfn_user_pool.admin_create_user_config = cognito.CfnUserPool.AdminCreateUserConfigProperty(
            allow_admin_create_user_only=True,
            invite_message_template=cognito.CfnUserPool.InviteMessageTemplateProperty(
                email_subject="Kakuyasu Timeline Diary への招待",
                email_message=(
                    "Kakuyasu Timeline Diary へようこそ！\n\n"
                    "Cloudflare Pagesデプロイ後のURLからログインしてください。\n"
                    "例: https://kakuyasu-timeline-diary.pages.dev\n\n"
                    "ユーザー名: {username}\n"
                    "初期パスワード: {####}\n\n"
                    "初回ログイン時にパスワードの変更が求められます。"
                ),
                sms_message="Kakuyasu Timeline Diary への招待です。ユーザー名:{username} 一時パスワード:{####}"
            )
        )

        # Outputs
        CfnOutput(self, "UserPoolId", value=user_pool.user_pool_id)
        CfnOutput(self, "UserPoolClientId", value=user_pool_client.user_pool_client_id)
        CfnOutput(self, "Region", value=self.region)
