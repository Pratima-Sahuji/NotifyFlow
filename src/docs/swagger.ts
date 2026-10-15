import swaggerJSDoc from 'swagger-jsdoc';
import { env } from '../config/env.js';

const swaggerDefinition = {
  openapi: '3.0.0',
  info: {
    title: 'NotifyFlow API',
    version: '1.0.0',
    description:
      'Production-Style Distributed Notification Backend with PostgreSQL, Redis, BullMQ, WebSockets, and FCM HTTP v1',
    contact: {
      name: 'NotifyFlow Engineering',
    },
  },
  servers: [
    {
      url: `http://localhost:${env.PORT}`,
      description: 'Local Development Server',
    },
  ],
  components: {
    securitySchemes: {
      BearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Enter your JWT Bearer token',
      },
    },
  },
};

const options: swaggerJSDoc.Options = {
  swaggerDefinition,
  apis: [
    './src/modules/**/*.routes.ts',
    './src/observability/*.routes.ts',
    './dist/modules/**/*.routes.js',
    './dist/observability/*.routes.js',
  ],
};

export const swaggerSpec = swaggerJSDoc(options);
