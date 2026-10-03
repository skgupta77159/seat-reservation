import { Request, Response, NextFunction } from "express";

export function authenticate(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const authorization = req.header("authorization");

  if (!authorization?.startsWith("Bearer ")) {
    return res.status(401).json({
      error: "unauthorized"
    });
  }

  const token = authorization.slice("Bearer ".length).trim();

  if (!token) {
    return res.status(401).json({
      error: "unauthorized"
    });
  }

  req.user = {
    id: token
  };

  next();
}


export function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const authorization = req.header("authorization");

  if (!authorization?.startsWith("Bearer ")) {
    return res.status(401).json({
      error: "unauthorized"
    });
  }

  const token = authorization.slice("Bearer ".length).trim();

  if (token !== process.env.ADMIN_TOKEN) {
    return res.status(403).json({
      error: "forbidden"
    });
  }

  req.user = {
    id: "admin"
  };

  next();
}