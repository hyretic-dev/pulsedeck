import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, UrlTree } from '@angular/router';

import { SessionService } from '../../core/session.service';
import { startGuard } from './start.guard';

describe('startGuard', () => {
    let session: SessionService;
    let router: Router;

    beforeEach(() => {
        localStorage.clear();
        TestBed.configureTestingModule({ providers: [provideRouter([])] });
        session = TestBed.inject(SessionService);
        router = TestBed.inject(Router);
    });

    const ziel = () => router.serializeUrl(TestBed.runInInjectionContext(() => startGuard({} as never, {} as never)) as UrlTree);

    it('leitet Abgemeldete zur Anmeldung', () => {
        expect(ziel()).toBe('/login');
    });

    it('leitet Angemeldete zu ihren Organisationen', () => {
        session.setze({ userId: 'u1', accessToken: 'a', refreshToken: 'r' });
        expect(ziel()).toBe('/organisationen');
    });
});
