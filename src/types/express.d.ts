declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
      };

      requestId: string;
    }
  }
}

export {};