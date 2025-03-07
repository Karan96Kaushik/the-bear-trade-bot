const mongoose = require('mongoose');

// Replace with your MongoDB connection string
const uri = process.env.dbCredsTheBear;
const dbName = 'the-bear';

async function connectToDatabase() {
  if (mongoose.connection.readyState === 1) return mongoose.connection;

  try {
    await mongoose.connect(uri, { dbName });
    console.log('Connected to MongoDB');
    return await mongoose.connection;
  } catch (error) {
    console.error('Error connecting to MongoDB:', error);
    throw error;
  }
}

async function closeConnection() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.close();
    console.log('Disconnected from MongoDB');
  }
}

module.exports = {
  connectToDatabase,
  closeConnection,
};
