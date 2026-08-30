import { getRegisterPasswordStrength } from '../passwordValidator';

describe('getRegisterPasswordStrength (issue #656)', () => {
  it('scores an empty password as 0 with no label', () => {
    const s = getRegisterPasswordStrength('');
    expect(s.score).toBe(0);
    expect(s.label).toBe('');
  });

  describe('Weak (score 1)', () => {
    it('is weak when shorter than 8 characters', () => {
      const s = getRegisterPasswordStrength('Ab1!');
      expect(s.score).toBe(1);
      expect(s.label).toBe('Weak');
      expect(s.barColor).toBe('bg-red-500');
    });

    it('is weak when 8+ chars but only one character class', () => {
      const s = getRegisterPasswordStrength('passwordpassword');
      expect(s.score).toBe(1);
      expect(s.label).toBe('Weak');
    });
  });

  describe('Fair (score 2)', () => {
    it('is fair with 8+ chars and exactly two character classes', () => {
      const s = getRegisterPasswordStrength('passWord');
      expect(s.classes).toBe(2);
      expect(s.score).toBe(2);
      expect(s.label).toBe('Fair');
      expect(s.barColor).toBe('bg-orange-500');
    });
  });

  describe('Strong (score 3)', () => {
    it('is strong with 8+ chars and three character classes', () => {
      const s = getRegisterPasswordStrength('Password1');
      expect(s.classes).toBe(3);
      expect(s.score).toBe(3);
      expect(s.label).toBe('Strong');
      expect(s.barColor).toBe('bg-blue-500');
    });

    it('stays strong (not very strong) with all 4 classes but under 12 chars', () => {
      const s = getRegisterPasswordStrength('Pass1!ab');
      expect(s.classes).toBe(4);
      expect(s.score).toBe(3);
      expect(s.label).toBe('Strong');
    });
  });

  describe('Very Strong (score 4)', () => {
    it('is very strong with 12+ chars and all four character classes', () => {
      const s = getRegisterPasswordStrength('Password123!');
      expect(s.classes).toBe(4);
      expect(s.score).toBe(4);
      expect(s.label).toBe('Very Strong');
      expect(s.barColor).toBe('bg-green-500');
    });

    it('drops to strong if 12+ chars but missing a class', () => {
      const s = getRegisterPasswordStrength('Passwordabc1');
      expect(s.classes).toBe(3);
      expect(s.score).toBe(3);
    });
  });

  describe('checklist dimensions', () => {
    it('reports each requirement independently', () => {
      const s = getRegisterPasswordStrength('Abcdef1!');
      expect(s.checks).toEqual({
        length: true,
        uppercase: true,
        number: true,
        special: true,
      });
    });

    it('flags unmet requirements', () => {
      const s = getRegisterPasswordStrength('abc');
      expect(s.checks).toEqual({
        length: false,
        uppercase: false,
        number: false,
        special: false,
      });
    });
  });

  it('marks Fair and above as acceptable for submission', () => {
    expect(getRegisterPasswordStrength('passWord').isAcceptable).toBe(true);
    expect(getRegisterPasswordStrength('Password123!').isAcceptable).toBe(true);
    expect(getRegisterPasswordStrength('password').isAcceptable).toBe(false);
    expect(getRegisterPasswordStrength('Ab1!').isAcceptable).toBe(false);
  });
});
