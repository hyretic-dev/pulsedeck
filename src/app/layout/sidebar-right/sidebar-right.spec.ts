import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { SidebarRight } from './sidebar-right';
import { SW_PUSH_STUB, stubMatchMedia } from '../../../testing/browser-stubs';

describe('SidebarRight', () => {
  let component: SidebarRight;
  let fixture: ComponentFixture<SidebarRight>;

  beforeEach(async () => {
    stubMatchMedia();
    await TestBed.configureTestingModule({
      imports: [SidebarRight],
      providers: [SW_PUSH_STUB, provideRouter([])],
    })
    .compileComponents();

    fixture = TestBed.createComponent(SidebarRight);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
