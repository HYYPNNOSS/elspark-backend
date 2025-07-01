// import { Request, Response, NextFunction } from "express";
// import jwt from "jsonwebtoken";

// export const verifyToken = (
//   req: Request,
//   res: Response,
//   next: NextFunction
// ) => {
//   const authHeader = req.headers.authorization;
//   if (!authHeader || !authHeader.startsWith("Bearer ")) {
//     res.status(401).json({ error: "Unauthorized" });
//     return;
//   }

//   const token = authHeader.split(" ")[1];
//   try {
//     const decoded = jwt.verify(token, process.env.JWT_SECRET as string);
//     (req as any).user = decoded;
//     next();
//   } catch (err) {
//     res.status(403).json({ error: "Token invalid or expired" });
//   }
// };

import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

interface AuthRequest extends Request {
  user?: {
    userId: number;
    email: string;
  };
}

interface JWTPayload {
  id?: number;
  userId?: number;
  email: string;
  iat?: number;
  exp?: number;
}

export const aiMiddleware = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as JWTPayload;
    
    // Debug logging to see what's in the token
    console.log("Decoded JWT payload:", decoded);
    
    // Handle both 'id' and 'userId' fields in JWT payload
    const userId = decoded.userId || decoded.id;
    
    if (!userId) {
      console.log("No userId or id found in JWT payload");
      res.status(401).json({ error: "Invalid token: missing user ID" });
      return;
    }
    
    req.user = {
      userId: userId,
      email: decoded.email
    };
    
    console.log("Set req.user:", req.user);
    next();
  } catch (err) {
    console.error("JWT verification error:", err);
    res.status(403).json({ error: "Token invalid or expired" });
  }
};