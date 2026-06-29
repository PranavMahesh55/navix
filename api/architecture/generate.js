module.exports = async (req, res) => {
  const { app } = await import("../../apps/api/dist/app.js");
  return app(req, res);
};
