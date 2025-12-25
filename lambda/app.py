import json
import os
import re
import uuid
import boto3
from botocore.config import Config
import datetime
from decimal import Decimal
from boto3.dynamodb.conditions import Key

# DynamoDB初期化
dynamodb = boto3.resource('dynamodb')
table_name = os.environ.get('TABLE_NAME', 'KakuyasuTimelineDiary')
table = dynamodb.Table(table_name)

# S3初期化
aws_region = os.environ.get('AWS_REGION', 'ap-northeast-1')
s3_client = boto3.client(
    's3',
    region_name=aws_region,
    config=Config(signature_version='s3v4')
)
user_content_bucket = os.environ.get('USER_CONTENT_BUCKET')
cloudfront_domain = os.environ.get('CLOUDFRONT_DOMAIN_NAME')

CONSENT_VERSION = "2025-12-21"
ALLOWED_UPLOAD_CONTENT_TYPES = {
    "application/octet-stream",
    "image/jpeg",
    "image/png",
    "image/webp",
}

def sanitize_filename(file_name):
    if not file_name or not isinstance(file_name, str):
        return None
    normalized = file_name.strip().replace("\\", "/")
    base_name = os.path.basename(normalized)
    safe_name = re.sub(r"[^A-Za-z0-9._-]", "_", base_name)
    if safe_name in ("", ".", ".."):
        return None
    return safe_name[:120]

# Decimal型をJSONシリアライズするためのエンコーダー
class DecimalEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, Decimal):
            return float(obj)
        return super(DecimalEncoder, self).default(obj)

def get_consent_item(user_id):
    pk = f"USER#{user_id}"
    sk = "CONSENT"
    return table.get_item(Key={'pk': pk, 'sk': sk}).get('Item')

def is_consent_valid(item):
    return bool(item) and item.get('agreed') is True and item.get('version') == CONSENT_VERSION

def lambda_handler(event, context):
    """
    メインハンドラー
    """
    print("Received event:", json.dumps(event))
    
    route_key = event.get('route_key') or event.get('routeKey', '')
    headers = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization"
    }

    if route_key.startswith("OPTIONS"):
        return {"statusCode": 200, "headers": headers, "body": ""}

    try:
        user_id = event['requestContext']['authorizer']['jwt']['claims']['sub']
    except (KeyError, TypeError):
        return {
            "statusCode": 401, 
            "headers": headers, 
            "body": json.dumps({"message": "Unauthorized"})
        }

    try:
        # ------------------------------------------------------------------
        # 同意の取得/保存
        # ------------------------------------------------------------------
        if route_key == "GET /consent":
            consent_item = get_consent_item(user_id)
            agreed = is_consent_valid(consent_item)
            return {
                "statusCode": 200,
                "headers": headers,
                "body": json.dumps({
                    "agreed": agreed,
                    "version": consent_item.get('version') if consent_item else None,
                    "requiredVersion": CONSENT_VERSION,
                    "agreedAt": consent_item.get('agreedAt') if consent_item else None
                }, cls=DecimalEncoder)
            }

        elif route_key == "POST /consent":
            body = json.loads(event.get('body', '{}'))
            agreed = body.get('agreed') is True
            if not agreed:
                return {
                    "statusCode": 400,
                    "headers": headers,
                    "body": json.dumps({"error": "agreed is required"})
                }

            version = body.get('version') or CONSENT_VERSION
            now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
            pk = f"USER#{user_id}"
            sk = "CONSENT"
            consent_item = {
                'pk': pk,
                'sk': sk,
                'userId': user_id,
                'agreed': True,
                'version': version,
                'agreedAt': now_iso
            }
            table.put_item(Item=consent_item)

            return {
                "statusCode": 200,
                "headers": headers,
                "body": json.dumps(consent_item, cls=DecimalEncoder)
            }

        consent_item = get_consent_item(user_id)
        if not is_consent_valid(consent_item):
            return {
                "statusCode": 403,
                "headers": headers,
                "body": json.dumps({
                    "message": "Consent required",
                    "requiredVersion": CONSENT_VERSION
                })
            }

        # ------------------------------------------------------------------
        # GET: 指定された年・月のデータを取得
        # ------------------------------------------------------------------
        if route_key == "GET /items":
            params = event.get('queryStringParameters') or {}
            now = datetime.datetime.now()
            target_year = params.get('year', str(now.year))
            target_month = params.get('month', f"{now.month:02}")

            pk = f"USER#{user_id}#YEAR#{target_year}"
            sk_prefix = f"DATE#{target_year}-{target_month}"

            print(f"Querying with pk={pk}, sk_prefix={sk_prefix}")

            response = table.query(
                KeyConditionExpression=Key('pk').eq(pk) & Key('sk').begins_with(sk_prefix)
            )
            
            items = response.get('Items', [])

            # 画像の署名付きURLを生成
            for day_item in items:
                for entry in day_item.get('orderedItems', []):
                    image_key = entry.get('imageKey')
                    if image_key:
                        try:
                            url = s3_client.generate_presigned_url(
                                'get_object',
                                Params={'Bucket': user_content_bucket, 'Key': image_key},
                                ExpiresIn=3600
                            )
                            entry['imageUrl'] = url
                        except Exception as e:
                            print(f"Error generating presigned URL: {e}")
            
            return {
                "statusCode": 200, 
                "headers": headers, 
                "body": json.dumps(items, cls=DecimalEncoder)
            }

        # ------------------------------------------------------------------
        # POST: アップロード用URL取得
        # ------------------------------------------------------------------
        elif route_key == "POST /upload-url":
            body = json.loads(event.get('body', '{}'))
            file_name = sanitize_filename(body.get('fileName')) or f"{uuid.uuid4()}.jpg"
            content_type = body.get('contentType', 'application/octet-stream')

            if content_type not in ALLOWED_UPLOAD_CONTENT_TYPES:
                return {
                    "statusCode": 400,
                    "headers": headers,
                    "body": json.dumps({"error": "Unsupported content type"})
                }
            
            # ユーザーごとのフォルダに保存
            image_key = f"users/{user_id}/{file_name}"
            
            try:
                presigned_url = s3_client.generate_presigned_url(
                    'put_object',
                    Params={
                        'Bucket': user_content_bucket,
                        'Key': image_key,
                        'ContentType': content_type
                    },
                    ExpiresIn=300
                )
                
                # CloudFront経由のURLに変換（CloudFrontドメインが設定されている場合）
                if cloudfront_domain:
                    # S3のURLをCloudFront URLに置き換え
                    presigned_url = presigned_url.replace(
                        f"s3.{aws_region}.amazonaws.com/{user_content_bucket}",
                        cloudfront_domain
                    )
                
                return {
                    "statusCode": 200,
                    "headers": headers,
                    "body": json.dumps({
                        "uploadUrl": presigned_url,
                        "imageKey": image_key
                    })
                }
            except Exception as e:
                return {
                    "statusCode": 500,
                    "headers": headers,
                    "body": json.dumps({"error": str(e)})
                }
            except Exception as e:
                return {
                    "statusCode": 500,
                    "headers": headers,
                    "body": json.dumps({"error": str(e)})
                }

        # ------------------------------------------------------------------
        # POST: データを保存 (ActivityPub Object)
        # ------------------------------------------------------------------
        elif route_key == "POST /items":
            body = json.loads(event.get('body', '{}'))
            
            item_id = body.get('id') or str(uuid.uuid4())
            body['id'] = item_id

            start_date_str = None
            end_date_str = None
            start_time = body.get('startTime')
            end_time = body.get('endTime')
            if start_time:
                start_date_str = start_time.split('T')[0]
                end_date_str = end_time.split('T')[0] if end_time else start_date_str
            else:
                published = body.get('published')
                if not published:
                    published = datetime.datetime.now().isoformat()
                    body['published'] = published
                start_date_str = published.split('T')[0]
                end_date_str = start_date_str

            body.pop('type', None)

            def date_range(start, end):
                current = datetime.datetime.strptime(start, "%Y-%m-%d").date()
                end_date = datetime.datetime.strptime(end, "%Y-%m-%d").date()
                while current <= end_date:
                    yield current
                    current += datetime.timedelta(days=1)

            for single_date in date_range(start_date_str, end_date_str):
                date_str = single_date.strftime("%Y-%m-%d")
                year_str = date_str.split('-')[0]
                pk = f"USER#{user_id}#YEAR#{year_str}"
                sk = f"DATE#{date_str}"

                existing = table.get_item(Key={'pk': pk, 'sk': sk}).get('Item')
                if not existing:
                    existing = {
                        'pk': pk,
                        'sk': sk,
                        'userId': user_id,
                        'orderedItems': []
                    }
                existing.pop('date', None)
                existing.pop('type', None)
                
                if 'orderedItems' not in existing:
                    existing['orderedItems'] = []
                
                items_list = existing['orderedItems']
                items_list = [i for i in items_list if i.get('id') != item_id]
                items_list.append(body)
                
                existing['orderedItems'] = items_list
                
                table.put_item(Item=existing)

            return {
                "statusCode": 200, 
                "headers": headers, 
                "body": json.dumps(body, cls=DecimalEncoder)
            }

        # ------------------------------------------------------------------
        # DELETE: データを削除
        # ------------------------------------------------------------------
        elif route_key.startswith("DELETE /items/"):
            params = event.get('queryStringParameters') or {}
            target_id = params.get('itemId')
            
            start_date_str = params.get('startDate') or params.get('date')
            end_date_str = params.get('endDate') or start_date_str

            if not target_id or not start_date_str:
                return {"statusCode": 400, "headers": headers, "body": json.dumps({"error": "itemId and date/startDate are required"})}

            def date_range(start, end):
                current = datetime.datetime.strptime(start, "%Y-%m-%d").date()
                end_date = datetime.datetime.strptime(end, "%Y-%m-%d").date()
                while current <= end_date:
                    yield current
                    current += datetime.timedelta(days=1)

            for single_date in date_range(start_date_str, end_date_str):
                date_str = single_date.strftime("%Y-%m-%d")
                year_str = date_str.split('-')[0]
                pk = f"USER#{user_id}#YEAR#{year_str}"
                sk = f"DATE#{date_str}"

                existing = table.get_item(Key={'pk': pk, 'sk': sk}).get('Item')
                if existing and 'orderedItems' in existing:
                    original_len = len(existing['orderedItems'])
                    existing['orderedItems'] = [i for i in existing['orderedItems'] if i.get('id') != target_id]
                    
                    if len(existing['orderedItems']) != original_len:
                        table.put_item(Item=existing)

            return {
                "statusCode": 200, 
                "headers": headers, 
                "body": json.dumps({"message": "Deleted"})
            }

        else:
            return {
                "statusCode": 404, 
                "headers": headers, 
                "body": json.dumps({"message": "Not Found"})
            }

    except Exception as e:
        print(f"Exception occurred: {str(e)}")
        import traceback
        traceback.print_exc()
        
        return {
            "statusCode": 500, 
            "headers": headers, 
            "body": json.dumps({"error": "Internal Server Error", "details": str(e)})
        }
