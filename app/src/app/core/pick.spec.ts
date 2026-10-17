import { pick } from './pick';

describe('pick', () => {
    it('wählt nur genannte Felder und lässt undefined weg', () => {
        expect(pick({ a: 1, b: 2, c: undefined, id: 'x' }, ['a', 'c', 'd'])).toEqual({ a: 1 });
    });

    it('wandelt leere Zeichenketten nur in den genannten Feldern zu null', () => {
        expect(pick({ phone: '', name: '', city: 'Köln' }, ['phone', 'name', 'city'], ['phone'])).toEqual({ phone: null, name: '', city: 'Köln' });
    });
});
