// logger.js

import winston from 'winston';

// This is our new, centralized logger.
// It's configured to be more powerful than the simple console.log.
const logger = winston.createLogger({
  // Level determines the minimum severity of messages to be logged.
  // 'info' means it will log info, warn, and error messages.
  level: 'info',

  // The format of our logs. We're adding a timestamp, the log level, and the message.
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => {
      return `${timestamp} ${level.toUpperCase()}: ${message}`;
    })
  ),

  // 'Transports' are the destinations for our logs. We can have multiple.
  transports: [
    // 1. Log to a file named 'error.log' for all errors.
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    
    // 2. Log to a file named 'combined.log' for all messages.
    new winston.transports.File({ filename: 'combined.log' }),

    // 3. Also log to the console, but with colors for better readability.
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message }) => {
          return `${timestamp} ${level}: ${message}`;
        })
      ),
    }),
  ],
});

export default logger;