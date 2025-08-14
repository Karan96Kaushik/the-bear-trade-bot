# The Bear Trade Bot - Lambda Function

This directory contains the AWS Lambda function for running the `scanZaireStocks` stock analysis function.

## Overview

The Lambda function wraps the `scanZaireStocks` function from the analytics module, allowing you to run stock scanning and analysis on AWS Lambda infrastructure.

## Files

- `handler.js` - Main Lambda handler function
- `package.json` - Lambda-specific dependencies
- `deploy.sh` - Deployment script
- `kite-utils-lambda.js` - Lambda-compatible version of kite/utils.js without Redis dependency

## Prerequisites

1. **AWS CLI** - Install and configure AWS CLI
   ```bash
   aws configure
   ```

2. **Node.js 18+** - The Lambda function runs on Node.js 18.x runtime

3. **IAM Role** - Create an IAM role for Lambda execution with the following permissions:
   - `AWSLambdaBasicExecutionRole` (managed policy)
   - Additional permissions if accessing other AWS services

## Deployment

1. **Update the deployment script** with your AWS account details:
   ```bash
   # Edit deploy.sh and replace:
   # - YOUR_ACCOUNT_ID with your AWS account ID
   # - Adjust the region if needed (default: us-east-1)
   ```

2. **Run the deployment script**:
   ```bash
   cd lambda
   chmod +x deploy.sh
   ./deploy.sh
   ```

## Usage

### Invoke via AWS CLI

```bash
# Basic invocation (uses NIFTY 50 stocks by default)
aws lambda invoke \
  --function-name scanZaireStocks \
  --payload '{}' \
  --region us-east-1 \
  response.json && cat response.json

# Custom stock list
aws lambda invoke \
  --function-name scanZaireStocks \
  --payload '{"stockList":["RELIANCE","TCS","INFY"],"checkV3":true}' \
  --region us-east-1 \
  response.json && cat response.json

# With specific parameters
aws lambda invoke \
  --function-name scanZaireStocks \
  --payload '{
    "stockList": ["RELIANCE", "TCS", "HDFCBANK"],
    "interval": "15m",
    "checkV3": true,
    "useCached": false,
    "endDateNew": "2024-01-15"
  }' \
  --region us-east-1 \
  response.json && cat response.json
```

### Invoke via AWS Console

1. Go to AWS Lambda Console
2. Find the `scanZaireStocks` function
3. Use the Test tab to create test events
4. Example test event:
   ```json
   {
     "stockList": ["RELIANCE", "TCS", "INFY"],
     "interval": "15m",
     "checkV3": true,
     "useCached": false
   }
   ```

## Input Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `stockList` | Array | NIFTY 50 | List of stock symbols to analyze |
| `endDateNew` | String | Today | End date for analysis (YYYY-MM-DD) |
| `interval` | String | '15m' | Time interval ('5m', '15m', '1h', '1d') |
| `checkV2` | Boolean | false | Enable V2 analysis conditions |
| `checkV3` | Boolean | false | Enable V3 analysis conditions |
| `useCached` | Boolean | false | Use cached data if available |
| `params` | Object | DEFAULT_PARAMS | Custom analysis parameters |
| `options` | Object | {} | Additional options |

## Response Format

```json
{
  "statusCode": 200,
  "body": {
    "success": true,
    "data": {
      "selectedStocks": [
        {
          "sym": "RELIANCE",
          "trend": "BULLISH",
          "price": 2500.50,
          "ma": 2480.25,
          "timestamp": "2024-01-15T10:30:00.000Z"
        }
      ],
      "metadata": {
        "totalProcessed": 50,
        "selectedCount": 3,
        "noDataCount": 2,
        "tooHighCount": 1,
        "incompleteCount": 0
      }
    },
    "timestamp": "2024-01-15T10:30:00.000Z",
    "inputParams": {
      "stockCount": 50,
      "interval": "15m",
      "checkV3": true
    }
  }
}
```

## Configuration

### Timeout and Memory

The function is configured with:
- **Timeout**: 300 seconds (5 minutes)
- **Memory**: 512 MB

You can adjust these in the deployment script if needed.

### Environment Variables

Set these environment variables in the Lambda function if needed:
- `DEBUG=true` - Enable debug logging
- `NODE_ENV=production` - Production environment

## Differences from Original

This Lambda version includes the following modifications:

1. **No Redis Dependency**: Uses RAM-based caching instead of Redis
2. **Simplified Setup**: Removed kite setup dependencies not needed for analysis
3. **Lambda Response Format**: Returns proper Lambda response with statusCode and headers
4. **Error Handling**: Comprehensive error handling with proper Lambda error responses
5. **CORS Headers**: Includes CORS headers for web application integration

## Troubleshooting

### Common Issues

1. **Timeout Errors**: Increase the timeout value in deploy.sh
2. **Memory Errors**: Increase the memory allocation
3. **Permission Errors**: Check IAM role permissions
4. **Package Too Large**: The deployment package is automatically optimized to include only production dependencies

### Monitoring

Check CloudWatch Logs for function execution logs:
```bash
aws logs tail /aws/lambda/scanZaireStocks --follow --region us-east-1
```

## Cost Optimization

- The function uses RAM caching to reduce external API calls
- Consider setting appropriate timeout values to avoid unnecessary charges
- Monitor invocation patterns and optimize accordingly 