const express = require('express');
const router = express.Router();
const { connectToDatabase } = require('../../modules/db');
const bcrypt = require('bcrypt');
const { generate, generateRefresh } = require('../modules/auth');

// User model (you'll need to create this)
const User = require('../../models/User');

router.post('/login', async (req, res) => {
  try {
    await connectToDatabase();
    const { username, password } = req.body;

    // Find user by username
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(400).json({ message: 'Invalid email or password' });
    }

    // Check password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid email or password' });
    }

    // Generate JWT tokens
    const accessToken = generate({ id: user._id, email: user.email, role: user.role });
    const refreshToken = generateRefresh({ id: user._id, email: user.email, role: user.role });

    res.json({
      message: 'Login successful',
      user: { id: user._id, email: user.email, role: user.role, username: user.username },
      accessToken,
      refreshToken
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/register', async (req, res) => {
  try {
    return res.status(500).json({ message: 'FUCK OFF' });

    await connectToDatabase();
    const { email, password, role, username } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'User already exists' });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Create new user
    const newUser = new User({
      email,
      username,
      password: hashedPassword,
      role: role || 'user' // Default role is 'user' if not specified
    });

    await newUser.save();

    // Generate JWT tokens
    const accessToken = generate({ id: newUser._id, email: newUser.email, role: newUser.role });
    const refreshToken = generateRefresh({ id: newUser._id, email: newUser.email, role: newUser.role });

    res.status(201).json({
      message: 'User registered successfully',
      user: { id: newUser._id, email: newUser.email, role: newUser.role },
      accessToken,
      refreshToken
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
