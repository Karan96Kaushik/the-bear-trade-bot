import json
import sys
import joblib
import pandas as pd
import numpy as np
from sklearn.preprocessing import StandardScaler

from datetime import datetime

pd.set_option('display.max_columns', None)

def preprocess_trading_data(array_obj=[]):
    start_time = datetime.now()
    print(f"Starting preprocessing at {start_time}")

    # Create DataFrame from input
    df = pd.DataFrame(array_obj)
    print(df)
    print(f"DataFrame creation elapsed: {datetime.now() - start_time}")

    # Load saved scaling parameters
    scaling_params = joblib.load('scaling_parameters.joblib')
    print(f"Loading scaling params elapsed: {datetime.now() - start_time}")

    df['Timestamp'] = pd.to_datetime(df['Timestamp'])

    df = df[df['Timestamp'].dt.hour != 15]
    df = df[df['Timestamp'].dt.hour != 14]

    # print('Original df shape:', df.shape)
    df = df.dropna()
    # print('Df shape after dropping NaNs:', df.shape)
    print(f"Data cleaning elapsed: {datetime.now() - start_time}")
    
    # Use pre-fitted label encoders
    le_candle = scaling_params['label_encoders']['candle_type']
    le_ma = scaling_params['label_encoders']['ma_direction']
    
    # Transform using pre-fitted encoders
    df['Candle Type'] = le_candle.transform(df['Candle Type'])
    df['MA Direction'] = le_ma.transform(df['MA Direction'])
    print(f"Label encoding elapsed: {datetime.now() - start_time}")

    rowwise_columns = [
        'High', 'Low', 'Open', 'Close', 
        # 'Low Day', 'High Day',
        'BB Middle', 'BB Upper', 'BB Lower',
        'T1H','T1L','T1O','T1C',
        'T2H','T2L','T2O','T2C',
        'T3H','T3L','T3O','T3C',
        'SMA44'
    ]
    
    regular_scale_columns = [
        # 'Volume Prev Day Avg', 
        # 'Volume P Last', 
        # 'Volume P 2nd Last',
        # 'Volume P 3rd Last', 
        'MA Trend Count',
        'RSI14'
    ]

    # Use pre-fitted scaler
    scaler = scaling_params['regular_scaler']
    scaled_features = pd.DataFrame()
    
    scaled_features[rowwise_columns] = df[rowwise_columns].apply(lambda x: (x - x.min()) / (x.max() - x.min()), axis=1)

    # Use pre-fitted scaler for regular columns
    scaled_features[regular_scale_columns] = scaler.transform(df[regular_scale_columns])
    
    # Create final DataFrame
    final_df = pd.concat([
        scaled_features,
        df[[
            'Candle Type', 
            'MA Direction'
        ]]
    ], axis=1)

    final_df = final_df.reset_index(drop=True)
    print(f"Total preprocessing elapsed: {datetime.now() - start_time}")

    return final_df

def load_rf_model(filename='rf_classifier_model.joblib'):
    """Load a trained Random Forest model and scaler from a file"""
    loaded = joblib.load(filename)
    return loaded['model']

def predict_market_direction(feature_dict):
    """
    Predict market direction using the trained random forest model
    
    Args:
        feature_dict (dict): Dictionary of features with the following keys:
            High, Low, Open, Close, SMA44, RSI14, BB Middle, BB Upper, BB Lower,
            T1H, T1L, T1O, T1C, MA Trend Count
    
    Returns:
        str: Predicted market direction ('bullish', 'bearish', or 'none')
    """
    start_time = datetime.now()
    print(f"Starting prediction at {start_time}")
    
    try:
        # Define expected features in exact order
        expected_features = [
            'High', 'Low', 'Open', 'Close', 'SMA44', 'RSI14',
            'BB Middle', 'BB Upper', 'BB Lower',
            'T1H', 'T1L', 'T1O', 'T1C', 'MA Trend Count'
        ]
        
        # Extract features in correct order
        df = pd.DataFrame([feature_dict])

        rf_clf = load_rf_model()
        print(f"Model loading elapsed: {datetime.now() - start_time}")

        processed_df = preprocess_trading_data(feature_dict)
        print(f"Data preprocessing elapsed: {datetime.now() - start_time}")

        # print(processed_df)
        

        columns_to_keep = [
            # 'Timestamp',
            # 'Candle Type',
            # 'Sym',
            'High',
            'Low',
            'Open',
            'Close',
            
            'SMA44',
            'RSI14',
            
            'BB Middle',
            'BB Upper',
            'BB Lower',

            'T1H',
            'T1L',
            'T1O',
            'T1C',

            # 'Market_Direction',
            'MA Trend Count',
        ]

        # processed_df = processed_df[columns_to_keep]

        X = processed_df
        print(X)
        # X = np.array(processed_df)
        
        # Make predictions for all rows
        predictions = rf_clf.predict(X)
        print(f"Prediction elapsed: {datetime.now() - start_time}")
        
        # Convert numerical predictions to labels and create results dictionary
        results = []
        for i, pred in enumerate(predictions):
            prediction = 'none' if pred == 2 else ('bearish' if pred == 0 else 'bullish')
            symbol = feature_dict[i]['Sym'] #if isinstance(feature_dict, list) else feature_dict['Sym']
            results.append({'symbol': symbol, 'prediction': prediction})
        
        return results[0] if len(results) == 1 else results
        
    except KeyError as e:
        return f"Error: Missing required feature {str(e)}"
    except Exception as e:
        return f"Error making prediction: {str(e)}"

def main():
    if len(sys.argv) != 2:
        print("Usage: python predict.py '{\"High\": 142.38, \"Low\": 141.39, ...}'")
        print("\nRequired features:")
        print("High, Low, Open, Close, SMA44, RSI14, BB Middle, BB Upper, BB Lower,")
        print("T1H, T1L, T1O, T1C, MA Trend Count")
        sys.exit(1)
    
    try:
        # Parse JSON object from command line argument
        feature_dict = json.loads(sys.argv[1])
        
        # Make prediction
        result = predict_market_direction(feature_dict)
        
        # Output result as JSON with symbol information
        print(json.dumps(result))
        # for r in result:
        #     print(r)

    except json.JSONDecodeError:
        print("Error: Invalid JSON input")
        print("Example format: {\"High\": 142.38, \"Low\": 141.39, ...}")
        sys.exit(1)
    except Exception as e:
        print(f"Error: {str(e)}")
        sys.exit(1)

if __name__ == "__main__":
    main() 