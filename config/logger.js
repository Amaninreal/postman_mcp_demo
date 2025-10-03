
import winston from 'winston';

const logger = winston.createLogger({
  level: 'info',

  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => {
      return `${timestamp} ${level.toUpperCase()}: ${message}`;
    })
  ),

  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    
    new winston.transports.File({ filename: 'combined.log' }),

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