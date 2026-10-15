import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { MainLayout } from './main-layout';
import { SW_PUSH_STUB, stubMatchMedia } from '../../../testing/browser-stubs';

describe('MainLayout', () => {
  let component: MainLayout;
  let fixture: ComponentFixture<MainLayout>;

  beforeEach(async () => {
    stubMatchMedia();
    await TestBed.configureTestingModule({
      imports: [MainLayout],
      providers: [SW_PUSH_STUB, provideRouter([])],
    })
    .compileComponents();

    fixture = TestBed.createComponent(MainLayout);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
