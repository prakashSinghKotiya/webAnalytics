# Uptime Monitoring - AWS Lambda Runner (`uptime-lambda`)

Zero-dependency AWS Lambda runner for executing batched uptime health checks. The function receives a list of URLs to probe, runs zero-dependency checks concurrently, and returns results back to the main server.

All database mutations, email alerts, cooldown throttling, and socket events remain on the primary server.

---

## Architecture & Configuration

| Parameter | Recommended Value | Notes |
| :--- | :--- | :--- |
| **Runtime** | `Node.js 20.x` | Supported on Node 18+ and 20+. |
| **Architecture** | `arm64` or `x86_64` | `arm64` (Graviton2/3) offers 20% lower cost. |
| **Region** | `ap-south-1` (Mumbai) | Default region or region closest to your target audience. |
| **Handler** | `index.handler` | Exported ESM async handler in `index.js`. |
| **Memory** | `256 MB` to `512 MB` | Sufficient for concurrent DNS and HTTP/TLS probes. |
| **Timeout** | `60 seconds` | Allows batch checks with retries to complete safely within deadline. |
| **VPC** | **No VPC (Direct Internet)** | **Do NOT attach to a VPC.** VPC placement adds cold starts and requires NAT Gateways to reach the public internet. |
| **Trigger / URL** | **None** | Do **NOT** attach an API Gateway or Function URL. The main backend invokes Lambda directly via AWS SDK (`InvokeCommand` with SigV4). |

---

## IAM User Permissions

Create an IAM User or Execution Role for the backend server with least privilege:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowLambdaInvokeOnly",
      "Effect": "Allow",
      "Action": "lambda:InvokeFunction",
      "Resource": "arn:aws:lambda:ap-south-1:<YOUR_ACCOUNT_ID>:function:<YOUR_FUNCTION_NAME>"
    }
  ]
}
```

Store the credentials in your backend `.env`:
```env
AWS_UPTIME_KEY_ID="AKIA..."
AWS_UPTIME_SECRET="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
```

---

## Packaging & Deployment

Because this package has zero third-party dependencies, you can zip the folder directly without running `npm install`:

```bash
cd uptime-lambda
zip -r lambda.zip index.js uptimeChecker.js package.json
```

Deploy via AWS CLI:
```bash
aws lambda create-function \
  --function-name uptime-runner-batch \
  --runtime nodejs20.x \
  --role arn:aws:iam::<ACCOUNT_ID>:role/<EXECUTION_ROLE> \
  --handler index.handler \
  --zip-file fileb://lambda.zip \
  --timeout 60 \
  --memory-size 256 \
  --region ap-south-1
```

Or update an existing function:
```bash
aws lambda update-function-code \
  --function-name uptime-runner-batch \
  --zip-file fileb://lambda.zip \
  --region ap-south-1
```

---

## Payload Format

### Request Payload:
```json
{
  "monitors": [
    { "id": 1, "url": "https://example.com" },
    { "id": 2, "url": "https://api.github.com" }
  ]
}
```

### Response Payload:
```json
{
  "results": [
    {
      "monitorId": 1,
      "result": {
        "status": "UP",
        "httpStatus": 200,
        "responseTime": 124,
        "timings": { "dns": 12, "tcp": 22, "tls": 35, "ttfb": 55 }
      }
    },
    {
      "monitorId": 2,
      "result": {
        "status": "UP",
        "httpStatus": 200,
        "responseTime": 85
      }
    }
  ]
}
```

