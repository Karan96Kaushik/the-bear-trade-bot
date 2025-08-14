#!/bin/bash

# Lambda deployment script for scanZaireStocks function

echo "Starting Lambda deployment process..."

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    echo "Error: AWS CLI is not installed. Please install it first."
    exit 1
fi

# Check if zip is available
if ! command -v zip &> /dev/null; then
    echo "Error: zip command is not available."
    exit 1
fi

# Set Lambda function name
FUNCTION_NAME="scanZaireStocks"
REGION="ap-south-1"  # Change this to your preferred region

# Install dependencies
echo "Installing dependencies..."
npm install

# Create deployment package
echo "Creating deployment package..."
rm -f lambda-deployment.zip

# Create temporary directory for packaging
mkdir -p temp-package

# Copy Lambda-specific files
cp handler.js temp-package/
cp package.json temp-package/

# Copy necessary modules from parent directory
cp -r ../analytics temp-package/
mkdir -p temp-package/kite
cp ../kite/utils.js temp-package/kite/utils.js
cp -r ../modules temp-package/

# Create node_modules in temp directory
cd temp-package
npm install --production

# Create zip file
zip -r ../lambda-deployment.zip . -x "*.git*" "*.DS_Store" "README.md" "deploy.sh"

# Clean up temp directory
cd ..
rm -rf temp-package

# Check if function exists
FUNCTION_EXISTS=$(aws lambda get-function --function-name $FUNCTION_NAME --region $REGION 2>/dev/null)

if [ $? -eq 0 ]; then
    echo "Function exists. Updating function code..."
    aws lambda update-function-code \
        --function-name $FUNCTION_NAME \
        --zip-file fileb://lambda-deployment.zip \
        --region $REGION
    
    echo "Updating function configuration..."
    aws lambda update-function-configuration \
        --function-name $FUNCTION_NAME \
        --timeout 300 \
        --memory-size 512 \
        --region $REGION
else
    echo "Function does not exist. Creating new function..."
    
    # You'll need to replace 'your-execution-role-arn' with your actual IAM role ARN
    # The role should have basic Lambda execution permissions
    aws lambda create-function \
        --function-name $FUNCTION_NAME \
        --runtime nodejs18.x \
        --role arn:aws:iam::329599656321:role/lambda-execution-role \
        --handler handler.handler \
        --zip-file fileb://lambda-deployment.zip \
        --timeout 300 \
        --memory-size 512 \
        --region $REGION \
        --description "Stock scanning function using Zaire strategy"
fi

if [ $? -eq 0 ]; then
    echo "✅ Lambda function deployed successfully!"
    echo "Function name: $FUNCTION_NAME"
    echo "Region: $REGION"
    echo ""
    echo "Test your function with:"
    echo "aws lambda invoke --function-name $FUNCTION_NAME --payload '{}' response.json --region $REGION"
else
    echo "❌ Deployment failed!"
    exit 1
fi

# Clean up
rm -f lambda-deployment.zip
echo "Deployment package cleaned up." 