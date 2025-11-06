import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET as string;

export const verifyToken = (req: any, res: Response, next: NextFunction) => {
  const token = req.headers.authorization?.split(" ")[1];

  console.log(token);
  if (!token) {
    res.status(401).json({ error: "No token provided" });
    return
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { 
      accountId: number; 
      profileId: number;
      id?: number; // For backwards compatibility
    };
    
    // Set both for compatibility
    req.user = {
      accountId: decoded.accountId,
      profileId: decoded.profileId || decoded.id,
      id: decoded.profileId || decoded.id // For old code that uses req.user.id
    };
    
    next();
  } catch (err) {
    res.status(401).json({ error: "Invalid or expired token" });
    return
  }
};

export const authenticate = verifyToken;