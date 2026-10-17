import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { SidebarLeft } from './sidebar-left';
import { SW_PUSH_STUB, stubMatchMedia } from '../../../testing/browser-stubs';

describe('SidebarLeft', () => {
  let component: SidebarLeft;
  let fixture: ComponentFixture<SidebarLeft>;

  beforeEach(async () => {
    stubMatchMedia();
    await TestBed.configureTestingModule({
      imports: [SidebarLeft],
      providers: [SW_PUSH_STUB, provideRouter([])],
    })
    .compileComponents();

    fixture = TestBed.createComponent(SidebarLeft);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
