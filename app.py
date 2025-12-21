#!/usr/bin/env python3
import os
import aws_cdk as cdk

# 先ほど作成したスタッククラスをインポート
from gekiyasu_diary_cdk_py.gekiyasu_diary_cdk_py_stack import GekiyasuDiaryCdkPyStack

app = cdk.App()

# スタックをインスタンス化
GekiyasuDiaryCdkPyStack(app, "KakuyasuTimelineDiaryStack",
    # 【激安ポイント】環境を明示的に指定することで、
    # リージョン情報(ap-northeast-1など)をコード内で正しく扱えるようになります
    env=cdk.Environment(
        account=os.getenv('CDK_DEFAULT_ACCOUNT'), 
        region=os.getenv('CDK_DEFAULT_REGION')
    ),
)

app.synth()
