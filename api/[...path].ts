import { app } from "../apps/api/src/app";

const handler = (req: Parameters<typeof app>[0], res: Parameters<typeof app>[1]) => {
  return app(req, res);
};

export default handler;
module.exports = handler;
