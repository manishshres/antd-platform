import { Module } from '@nestjs/common';
import { PublicMenusController } from './public-menus.controller';
import { PublicOrdersController } from './public-orders.controller';
import { PublicCustomersController } from './public-customers.controller';
import { PublicTablesController } from './public-tables.controller';
import { PublicLocationsController } from './public-locations.controller';
import { PublicDiscountsController } from './public-discounts.controller';
import { PublicEmployeesController } from './public-employees.controller';
import { PublicCallsController } from './public-calls.controller';
import { MenusModule } from '../menus/menus.module';
import { OrdersModule } from '../orders/orders.module';
import { CustomersModule } from '../customers/customers.module';
import { TablesModule } from '../tables/tables.module';
import { LocationsModule } from '../locations/locations.module';
import { DiscountsModule } from '../discounts/discounts.module';
import { UsersModule } from '../users/users.module';
import { CallsModule } from '../calls/calls.module';

@Module({
  imports: [
    MenusModule,
    OrdersModule,
    CustomersModule,
    TablesModule,
    LocationsModule,
    DiscountsModule,
    UsersModule,
    CallsModule,
  ],
  controllers: [
    PublicMenusController,
    PublicOrdersController,
    PublicCustomersController,
    PublicTablesController,
    PublicLocationsController,
    PublicDiscountsController,
    PublicEmployeesController,
    PublicCallsController,
  ],
})
export class PublicApiModule {}
