const smm = require('../src/services/smmguo');

describe('SMM Guo service wrapper', () => {
  test('getPlatforms returns an array', async () => {
    const platforms = await smm.getPlatforms();
    expect(Array.isArray(platforms)).toBe(true);
    expect(platforms.length).toBeGreaterThan(0);
    expect(platforms[0]).toHaveProperty('id');
    expect(platforms[0]).toHaveProperty('name');
  });

  test('getCategories returns array', async () => {
    const cats = await smm.getCategories('1');
    expect(Array.isArray(cats)).toBe(true);
    expect(cats[0]).toHaveProperty('id');
  });

  test('getServices returns array', async () => {
    const svcs = await smm.getServices('1');
    expect(Array.isArray(svcs)).toBe(true);
    expect(svcs[0]).toHaveProperty('id');
  });
});
