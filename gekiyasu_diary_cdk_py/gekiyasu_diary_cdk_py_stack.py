from aws_cdk import (
    Stack,
    RemovalPolicy,
    CfnOutput,
    Duration,
    aws_dynamodb as dynamodb,
    aws_lambda as _lambda,
    aws_apigatewayv2 as apigatewayv2,
    aws_iam as iam,
    aws_s3 as s3,
    aws_cloudfront as cloudfront,
    aws_cloudfront_origins as origins,
    aws_s3_deployment as s3_deploy,
    aws_cognito as cognito,
)
from constructs import Construct
import yaml
import os

class GekiyasuDiaryCdkPyStack(Stack):

    def __init__(self, scope: Construct, construct_id: str, **kwargs) -> None:
        super().__init__(scope, construct_id, **kwargs)

        # 1. DynamoDB
        table = dynamodb.Table(
            self, "KakuyasuTimelineTable",
            table_name="KakuyasuTimelineDiary",
            partition_key=dynamodb.Attribute(name="pk", type=dynamodb.AttributeType.STRING),
            sort_key=dynamodb.Attribute(name="sk", type=dynamodb.AttributeType.STRING),
            billing_mode=dynamodb.BillingMode.PAY_PER_REQUEST,
            removal_policy=RemovalPolicy.DESTROY, 
        )

        # 2. Lambda
        handler = _lambda.Function(
            self, "KakuyasuTimelineHandler",
            runtime=_lambda.Runtime.PYTHON_3_11,
            code=_lambda.Code.from_asset("lambda"),
            handler="app.lambda_handler",
            architecture=_lambda.Architecture.ARM_64,
            environment={"TABLE_NAME": table.table_name},
        )
        table.grant_read_write_data(handler)

        # ==========================================
        # ★ 3. Cognito User Pool (セルフサインアップ + 管理者承認)
        # ==========================================
        user_pool = cognito.UserPool(
            self, "KakuyasuTimelineUserPool",
            user_pool_name="kakuyasu-timeline-diary-user-pool",
            # セルフサインアップを許可し、メールまたは電話番号で登録可能
            self_sign_up_enabled=True,
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

        user_pool_client = user_pool.add_client(
            "KakuyasuTimelineUserPoolClient",
            user_pool_client_name="web-app-client",
            auth_flows=cognito.AuthFlow(
                user_srp=True,
                user_password=True
            ),
        )

        # 4. API Gateway
        openapi_path = os.path.join(os.path.dirname(__file__), "..", "openapi", "api-spec.yaml")
        with open(openapi_path, 'r', encoding='utf-8') as f:
            spec_content = f.read()

        lambda_integration_uri = f"arn:aws:apigateway:{self.region}:lambda:path/2015-03-31/functions/{handler.function_arn}/invocations"

        spec_content = spec_content.replace("${KakuyasuTimelineFunctionArn}", lambda_integration_uri)
        spec_content = spec_content.replace("${ClientId}", user_pool_client.user_pool_client_id)
        spec_content = spec_content.replace("${UserPoolId}", user_pool.user_pool_id)
        spec_content = spec_content.replace("${Region}", self.region)
        spec_dict = yaml.safe_load(spec_content)

        spec_dict["x-amazon-apigateway-cors"] = {
            "allowMethods": ["GET", "POST", "DELETE", "OPTIONS"],
            "allowHeaders": ["Content-Type", "Authorization"],
            "allowOrigins": ["*"],
            "maxAge": 600
        }

        api = apigatewayv2.CfnApi(
            self, "KakuyasuTimelineHttpApi",
            body=spec_dict
        )

        apigatewayv2.CfnStage(
            self, "ApiStage",
            api_id=api.ref,
            stage_name="$default",
            auto_deploy=True
        )

        handler.add_permission(
            "PermitAPIGatewayV2",
            principal=iam.ServicePrincipal("apigateway.amazonaws.com"),
            source_arn=f"arn:aws:execute-api:{self.region}:{self.account}:{api.ref}/*"
        )

        # 5. S3 & CloudFront
        website_bucket = s3.Bucket(
            self, "WebsiteBucket",
            removal_policy=RemovalPolicy.DESTROY,
            auto_delete_objects=True,
            block_public_access=s3.BlockPublicAccess.BLOCK_ALL,
        )

        distribution = cloudfront.Distribution(
            self, "WebsiteDistribution",
            default_root_object="index.html",
            default_behavior=cloudfront.BehaviorOptions(
                origin=origins.S3BucketOrigin.with_origin_access_control(website_bucket),
                viewer_protocol_policy=cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
            ),
            error_responses=[
                cloudfront.ErrorResponse(
                    http_status=404,
                    response_http_status=200,
                    response_page_path="/index.html",
                    ttl=Duration.seconds(0)
                )
            ]
        )

        # 6. Deployment
        web_app_path = os.path.join(os.path.dirname(__file__), "..", "web-app", "dist")
        if os.path.exists(web_app_path):
            s3_deploy.BucketDeployment(
                self, "DeployWebsite",
                sources=[s3_deploy.Source.asset(web_app_path)],
                destination_bucket=website_bucket,
                distribution=distribution,
                distribution_paths=["/*"]
            )

        # 7. Outputs
        CfnOutput(self, "ApiUrl", value=f"https://{api.ref}.execute-api.{self.region}.amazonaws.com")
        CfnOutput(self, "CloudFrontUrl", value=f"https://{distribution.distribution_domain_name}")
        CfnOutput(self, "UserPoolId", value=user_pool.user_pool_id)
        CfnOutput(self, "UserPoolClientId", value=user_pool_client.user_pool_client_id)
