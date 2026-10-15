import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { DashboardHome } from './dashboard-home';
import { SW_PUSH_STUB, stubMatchMedia } from '../../../../testing/browser-stubs';

describe('DashboardHome', () => {
  let component: DashboardHome;
  let fixture: ComponentFixture<DashboardHome>;

  beforeEach(async () => {
    stubMatchMedia();
    await TestBed.configureTestingModule({
      imports: [DashboardHome],
      providers: [SW_PUSH_STUB, provideRouter([])],
    })
    .compileComponents();

    fixture = TestBed.createComponent(DashboardHome);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
