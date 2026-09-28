export function createStore() {
  let stock = 3;
  let sales = 0;
  return {
    snapshot: () => ({ stock, sales }),
    reset() { stock = 3; sales = 0; },
    buy() {
      if (stock <= 0) return false;
      stock -= 1;
      sales += 1;
      return true;
    },
    backup: () => JSON.stringify({ stock, sales }),
    restore(raw) {
      const value = JSON.parse(raw);
      if (!Number.isInteger(value.stock) || !Number.isInteger(value.sales) || value.stock < 0 || value.sales < 0) throw new Error('backup inválido');
      stock = value.stock;
      sales = value.sales;
    }
  };
}
