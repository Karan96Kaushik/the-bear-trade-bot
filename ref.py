import datetime
import pandas as pd
import requests

# Define headers to mimic a browser session and avoid HTTP 403 errors
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
}


def get_nse_historical_data(symbol, series="EQ"):
    """Fetches 1 year of historical data for a given NSE scrip symbol."""
    # Step 1: Establish a session to capture required cookies automatically
    session = requests.Session()
    session.headers.update(HEADERS)

    # Visit the main website first to initialize cookies
    base_url = "https://nseindia.com"
    session.get(base_url, timeout=10)

    # Step 2: Set up date ranges for the past 1 year
    end_date = datetime.date.today()
    start_date = end_date - datetime.timedelta(days=365)

    # Format dates as DD-MM-YYYY as required by the NSE API
    from_date_str = start_date.strftime("%d-%m-%Y")
    to_date_str = end_date.strftime("%d-%m-%Y")

    print(f"Fetching data for {symbol} from {from_date_str} to {to_date_str}...")

    # Step 3: Query the specific historical data endpoint
    api_url = f"https://nseindia.com/api/historical/cm/equity?symbol={symbol}&series=[%22{series}%22]&from={from_date_str}&to={to_date_str}"

    response = session.get(api_url, timeout=10)

    if response.status_code != 200:
        raise Exception(
            f"Failed to fetch data. HTTP Status Code: {response.status_code}"
        )

    # Step 4: Parse JSON payload into a Pandas DataFrame
    json_data = response.json()

    if "data" not in json_data or not json_data["data"]:
        print("No data found for the given symbol and date range.")
        return None

    # Extract the nested records
    records = [item["CH_MARKET_DATA"] for item in json_data["data"]]
    df = pd.DataFrame(records)

    # Step 5: Clean up and format columns
    rename_dict = {
        "CH_TIMESTAMP": "Date",
        "CH_OPENING_PRICE": "Open",
        "CH_TRADE_HIGH_PRICE": "High",
        "CH_TRADE_LOW_PRICE": "Low",
        "CH_CLOSING_PRICE": "Close",
        "CH_LAST_TRADED_PRICE": "LTP",
        "CH_TOT_TRADED_QTY": "Volume",
    }

    df = df[list(rename_dict.keys())].rename(columns=rename_dict)
    df["Date"] = pd.to_datetime(df["Date"])
    df = df.sort_values(by="Date").reset_index(drop=True)

    return df


# --- Example Usage ---
if _name_ == "_main_":
    # Example symbol: State Bank of India (SBIN)
    scrip_symbol = "SBIN"

    try:
        historical_df = get_nse_historical_data(scrip_symbol)

        if historical_df is not None:
            # Preview the last 5 rows of data
            print("\nData successfully retrieved!")
            print(historical_df.tail())

            # Optional: Save to a local CSV file
            historical_df.to_csv(f"{scrip_symbol}_1year_history.csv", index=False)
            print(f"\nSaved data to {scrip_symbol}_1year_history.csv")

    except Exception as e:
        print(f"An error occurred: {e}")