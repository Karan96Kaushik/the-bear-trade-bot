#!/bin/bash

# Script to create IAM role for Lambda execution

ROLE_NAME="lambda-execution-role"
POLICY_NAME="lambda-execution-policy"
ACCOUNT_ID="329599656321"

echo "Creating IAM role for Lambda execution..."

# Create trust policy document
cat > trust-policy.json << EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "lambda.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
EOF

# Create the IAM role
echo "Creating IAM role: $ROLE_NAME"
aws iam create-role \
  --role-name $ROLE_NAME \
  --assume-role-policy-document file://trust-policy.json \
  --description "Execution role for scanZaireStocks Lambda function"

if [ $? -eq 0 ]; then
    echo "✅ IAM role created successfully"
else
    echo "ℹ️  Role might already exist, continuing..."
fi

# Attach the basic Lambda execution policy
echo "Attaching basic Lambda execution policy..."
aws iam attach-role-policy \
  --role-name $ROLE_NAME \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole

# Create custom policy for additional permissions (if needed)
cat > lambda-policy.json << EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:*:*:*"
    }
  ]
}
EOF

# Create and attach custom policy
echo "Creating custom policy: $POLICY_NAME"
aws iam create-policy \
  --policy-name $POLICY_NAME \
  --policy-document file://lambda-policy.json \
  --description "Custom policy for scanZaireStocks Lambda function"

if [ $? -eq 0 ]; then
    echo "✅ Custom policy created successfully"
    
    # Attach custom policy to role
    echo "Attaching custom policy to role..."
    aws iam attach-role-policy \
      --role-name $ROLE_NAME \
      --policy-arn arn:aws:iam::$ACCOUNT_ID:policy/$POLICY_NAME
else
    echo "ℹ️  Custom policy might already exist, continuing..."
fi

# Wait for role to be ready
echo "Waiting for role to be ready..."
sleep 10

# Verify role exists
echo "Verifying role..."
aws iam get-role --role-name $ROLE_NAME

if [ $? -eq 0 ]; then
    echo "✅ IAM role setup completed successfully!"
    echo "Role ARN: arn:aws:iam::$ACCOUNT_ID:role/$ROLE_NAME"
    echo ""
    echo "You can now run the Lambda deployment script."
else
    echo "❌ Failed to verify IAM role"
    exit 1
fi

# Clean up temporary files
rm -f trust-policy.json lambda-policy.json

echo "Temporary files cleaned up." 