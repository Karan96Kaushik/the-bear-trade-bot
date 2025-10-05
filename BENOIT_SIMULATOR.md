# Benoit Simulator

The Benoit simulator is a **bearish trading strategy** that identifies stocks with specific technical conditions for short selling opportunities.

## Strategy Logic

The Benoit scanner looks for stocks meeting ALL of the following conditions:

### 1. Bearish Definition
- **Condition**: `[-1] close < ([-1] high + [-1] low) / 2`
- **Explanation**: The previous 5-minute candle's close must be below its midpoint, indicating bearish sentiment

### 2. Placement on Moving Average
- **Condition**: `[-1] low * 0.999 <= [-1] SMA(close, 22) AND [-1] high * 1.001 >= [-1] SMA(close, 22)`
- **Explanation**: The previous candle must be touching or very close to the 22-period Simple Moving Average (SMA)
  - The SMA should be between 99.9% of the low and 100.1% of the high

### 3. Max Stock Price
- **Condition**: `[0] close < 5000`
- **Explanation**: Current candle's close price must be under ₹5000

### 4. Candle Size Condition (Narrow Range)
- **Condition**: `([0] high - [0] low) <= ([0] high + [0] low) / 2 * 0.005`
- **Explanation**: Current candle must have a narrow range (less than 0.5% of the average price)
  - This indicates consolidation or indecision

### 5. Entry Point
- **Condition**: `[0] low < [-1] low`
- **Explanation**: Current candle's low must break below the previous candle's low
  - This confirms the bearish breakdown

## Notation
- `[0]` = Current 5-minute candle
- `[-1]` = Previous 5-minute candle
- `SMA(close, 22)` = 22-period Simple Moving Average of close prices

## Usage

### API Endpoint
```
POST /api/simulate/v2/start
```

### Request Body Example
```json
{
  "startdate": "2024-10-01T00:00:00.000Z",
  "enddate": "2024-10-15T00:00:00.000Z",
  "symbol": "RELIANCE,TCS",  // Optional, comma-separated
  "simulation": {
    "type": "benoit",
    "targetStopLossRatio": "2:1",
    "cancelInMins": 30,
    "updateSL": true,
    "updateSLInterval": 5,
    "updateSLFrequency": 5,
    "marketOrder": false,
    "enableDoubleConfirmation": false,
    "doubleConfirmationLookbackHours": 3
  },
  "selectionParams": {
    "STOCK_LIST": "HIGHBETA!B2:B150"
  }
}
```

### Check Status
```
GET /api/simulate/v2/status/:jobId?type=benoit
```

## Files Created

1. **Scanner**: `/analytics/benoit.js`
   - Contains `scanBenoitStocks()` function
   - Filters stocks based on the 5 conditions above

2. **Controller**: `/express-server/controllers/simulateBenoit.js`
   - Contains simulation logic
   - Manages background jobs
   - Executes trades using SimulatorV3

3. **Routes**: `/express-server/routes/simulation.js`
   - Updated to include Benoit endpoints
   - Handles start and status check requests

## Trading Logic

Once a stock is identified by the scanner:

1. **Direction**: Always BEARISH (short selling)
2. **Trigger Price**: `stock.low - triggerPadding`
3. **Stop Loss**: `stock.high + (candleLength * (stopLossMultiplier - 1)) + triggerPadding`
4. **Target**: `stock.low - (candleLength * targetMultiplier) - triggerPadding`
5. **Risk**: Fixed ₹100 per trade
6. **Quantity**: Calculated based on risk amount

## Key Features

- ✅ Scans every 5 minutes during market hours (9:20 AM - 2:35 PM IST)
- ✅ Avoids weekend and market holidays
- ✅ Supports batch processing of stocks
- ✅ Optional trailing stop loss
- ✅ Optional double confirmation for entries/exits
- ✅ Background job processing with status polling
- ✅ Filters out duplicate trades on the same stock

## Example Output

```javascript
{
  "sym": "RELIANCE",
  "open": 2450.5,
  "close": 2448.3,
  "high": 2452.0,
  "low": 2447.8,
  "time": "2024-10-01 10:25:00",
  "direction": "BEARISH",
  "sma22": 2450.1,
  "previousCandle": {
    "open": 2451.0,
    "close": 2449.2,
    "high": 2453.0,
    "low": 2449.0,
    "sma22": 2450.5
  }
}
```

## Notes

- The scanner uses cached Yahoo Finance data for historical simulations
- Real-time trading would use live data feeds
- All conditions must be met simultaneously for a stock to be selected
- The strategy is purely bearish and looks for breakdown opportunities

