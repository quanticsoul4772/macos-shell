import { describe, it, expect } from '@jest/globals';

describe('Simple Command Test', () => {
  describe('Basic Math', () => {
    it('should add numbers correctly', () => {
      expect(1 + 1).toBe(2);
    });
    
    it('should multiply numbers correctly', () => {
      expect(3 * 4).toBe(12);
    });
  });
  
  describe('String Operations', () => {
    it('should concatenate strings', () => {
      const result = 'Hello' + ' ' + 'World';
      expect(result).toBe('Hello World');
    });
    
    it('should convert to uppercase', () => {
      expect('test'.toUpperCase()).toBe('TEST');
    });
  });
  
  describe('Array Operations', () => {
    it('should filter array', () => {
      const numbers = [1, 2, 3, 4, 5];
      const evens = numbers.filter(n => n % 2 === 0);
      expect(evens).toEqual([2, 4]);
    });
    
    it('should map array', () => {
      const numbers = [1, 2, 3];
      const doubled = numbers.map(n => n * 2);
      expect(doubled).toEqual([2, 4, 6]);
    });
  });
});