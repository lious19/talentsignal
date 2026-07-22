import { describe, expect, it, vi } from "vitest";
import jwt from "jsonwebtoken";
import type { NextFunction, Request, Response } from "express";
import { requireAuth } from "../src/middleware/requireAuth";

function fakeRes() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res as unknown as Response & { statusCode: number; body: unknown };
}

function fakeReq(authHeader?: string): Request {
  return {
    header: (name: string) => (name.toLowerCase() === "authorization" ? authHeader : undefined),
  } as unknown as Request;
}

describe("requireAuth middleware", () => {
  it("rejects a request with no Authorization header", () => {
    const res = fakeRes();
    const next = vi.fn();

    requireAuth(fakeReq(undefined), res, next as NextFunction);

    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects a header that isn't a Bearer token", () => {
    const res = fakeRes();
    const next = vi.fn();

    requireAuth(fakeReq("Basic somecredentials"), res, next as NextFunction);

    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects a malformed token", () => {
    const res = fakeRes();
    const next = vi.fn();

    requireAuth(fakeReq("Bearer not-a-real-token"), res, next as NextFunction);

    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects an expired token", () => {
    const res = fakeRes();
    const next = vi.fn();
    const expiredToken = jwt.sign(
      { sub: "user-1", role: "sales", exp: Math.floor(Date.now() / 1000) - 60 },
      process.env.JWT_SECRET as string,
    );

    requireAuth(fakeReq(`Bearer ${expiredToken}`), res, next as NextFunction);

    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("accepts a valid token and attaches req.user", () => {
    const res = fakeRes();
    const next = vi.fn();
    const req = fakeReq();
    const token = jwt.sign({ sub: "user-1", role: "sales" }, process.env.JWT_SECRET as string, {
      expiresIn: "1h",
    });
    req.header = ((name: string) =>
      name.toLowerCase() === "authorization" ? `Bearer ${token}` : undefined) as Request["header"];

    requireAuth(req, res, next as NextFunction);

    expect(next).toHaveBeenCalledOnce();
    expect(req.user).toEqual({ id: "user-1", role: "sales" });
  });
});
