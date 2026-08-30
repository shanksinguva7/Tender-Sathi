// @ts-nocheck
const { initTRPC } = require("@trpc/server");

const tRPCContext = initTRPC.create({
  errorFormatter({ shape, error }) {
    const zodError = error.cause?.flatten?.().fieldErrors ?? null;
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError,
      },
    };
  },
});

const router = tRPCContext.router;
const publicProcedure = tRPCContext.procedure;

module.exports = { tRPCContext, router, publicProcedure };
