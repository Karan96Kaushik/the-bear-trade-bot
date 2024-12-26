const { spawn } = require('child_process');

const pythonLoc = process.env.NODE_ENV != 'production' ? '/Users/karankaushik/miniconda/envs/mlEnv/bin/python' : '/home/ubuntu/miniconda3/envs/env1/bin/python'

function predictMarketDirection(data) {
    return new Promise((resolve, reject) => {
        // Spawn python process
        const pythonProcess = spawn(pythonLoc, ['ml/predict.py', JSON.stringify(data)]);
        
        let result = '';
        let error = '';

        // Collect data from stdout
        pythonProcess.stdout.on('data', (data) => {
            let str = data.toString()
            // if (str.includes('{')) {
            //     console.log('>>', str)
                result += str;
            // }
        });

        // Collect any errors
        pythonProcess.stderr.on('data', (data) => {
            error += data.toString();
        });

        // Handle process completion
        pythonProcess.on('close', (code) => {
            if (code !== 0) {
                reject(new Error(`Python process exited with code ${code}\n${error}`));
            } else {
                try {
                    const res = result.trim().split('\n')
                                .filter(r => r.includes('{'))
                                .map(r => {
                                    try {
                                        return JSON.parse(r)
                                    } catch (error) {
                                        console.error('Error parsing', r, error)                                        
                                    }
                                })
                                .filter(Boolean)
                    resolve(res[0]);
                } catch (e) {
                    reject(new Error(`Failed to parse Python output: ${e.message}`));
                }
            }
        });
    });
}

// Example usage
async function main() {
    const testData = [
        {
          "Timestamp": "2024-12-23 09:45:00",
          "Candle Type": "FT",
          "Sym": "SAPPHIRE",
          "High": 313.5,
          "Low": 308.04998779296875,
          "Open": 313.20001220703125,
          "Close": 309.1499938964844,
          "Volume": 72023,
          "SMA44": 310.93,
          "RSI14": 41.31154720243315,
          "BB Middle": 312.67999572753905,
          "BB Upper": 315.6631799877537,
          "BB Lower": 309.6968114673244,
          "T1H": 320.75,
          "T1L": 312.20001220703125,
          "T1O": 314.70001220703125,
          "T1C": 313.54998779296875,
          "T2H": 317.3999938964844,
          "T2L": 312,
          "T2O": 312,
          "T2C": 315.04998779296875,
          "T3H": 314,
          "T3L": 310.1000061035156,
          "T3O": 311.1499938964844,
          "T3C": 310.1000061035156,
          "Volume Prev Day Avg": 3239.125,
          "Volume P Last": 45193,
          "Volume P 2nd Last": 25566,
          "Volume P 3rd Last": 15866,
          "Low Day": 308.04998779296875,
          "High Day": 325.95001220703125,
          "MA Direction": "BULLISH",
          "MA Trend Count": 23,
          "Acheieved": true
        }
      ]

    try {
        const prediction = (await predictMarketDirection(testData))
        console.log('Prediction:', prediction);
    } catch (error) {
        console.error('Error:', error.message);
    }
}

// main(); 

module.exports = {
    predictMarketDirection
}