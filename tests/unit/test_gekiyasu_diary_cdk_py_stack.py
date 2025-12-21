import aws_cdk as core
import aws_cdk.assertions as assertions

from gekiyasu_diary_cdk_py.gekiyasu_diary_cdk_py_stack import GekiyasuDiaryCdkPyStack

# example tests. To run these tests, uncomment this file along with the example
# resource in gekiyasu_diary_cdk_py/gekiyasu_diary_cdk_py_stack.py
def test_sqs_queue_created():
    app = core.App()
    stack = GekiyasuDiaryCdkPyStack(app, "KakuyasuTimelineDiaryStack")
    template = assertions.Template.from_stack(stack)

#     template.has_resource_properties("AWS::SQS::Queue", {
#         "VisibilityTimeout": 300
#     })
