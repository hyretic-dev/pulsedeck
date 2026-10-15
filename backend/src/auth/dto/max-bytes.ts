import { registerDecorator, ValidationOptions } from 'class-validator';

/** Zeichenkette darf höchstens `max` Bytes (UTF-8) belegen; Zeichen wie „ä“ oder Emojis zählen mehrfach. */
export function MaxBytes(max: number, options?: ValidationOptions) {
  return (objekt: object, eigenschaft: string): void => {
    registerDecorator({
      name: 'maxBytes',
      target: objekt.constructor,
      propertyName: eigenschaft,
      constraints: [max],
      options: {
        message: `${eigenschaft} darf höchstens ${max} Bytes lang sein (bcrypt kürzt längere Passwörter still)`,
        ...options,
      },
      validator: {
        validate: (wert: unknown) => typeof wert === 'string' && Buffer.byteLength(wert, 'utf8') <= max,
      },
    });
  };
}
