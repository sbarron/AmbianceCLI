module.exports = {
  pipeline: jest.fn().mockResolvedValue({
    mockImplementation: (texts) => Promise.resolve({
      data: new Float32Array(texts.length * 384).fill(0.1),
    }),
  }),
};
