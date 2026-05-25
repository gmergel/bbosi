import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', loadComponent: () => import('./pages/stock-selection/stock-selection').then(m => m.StockSelectionComponent) },
  { path: 'options/:ticker', loadComponent: () => import('./pages/options-list/options-list').then(m => m.OptionsListComponent) },
  { path: '**', redirectTo: '' },
];
