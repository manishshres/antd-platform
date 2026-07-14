import { Module } from '@nestjs/common';
import { PublicMenusController } from './public-menus.controller';
import { PublicOrdersController } from './public-orders.controller';
import { PublicCustomersController } from './public-customers.controller';
import { PublicTablesController } from './public-tables.controller';
import { PublicLocationsController } from './public-locations.controller';
import { PublicDiscountsController } from './public-discounts.controller';
import { MenusModule } from '../menus/menus.module';
import { OrdersModule } from '../orders/orders.module';
import { CustomersModule } from '../customers/customers.module';
import { TablesModule } from '../tables/tables.module';
import { LocationsModule } from '../locations/locations.module';
import { DiscountsModule } from '../discounts/discounts.module';

@Module({
  imports: [
    MenusModule,
    OrdersModule,
    CustomersModule,
    TablesModule,
    LocationsModule,
    DiscountsModule,
  ],
  controllers: [
    PublicMenusController,
    PublicOrdersController,
    PublicCustomersController,
    PublicTablesController,
    PublicLocationsController,
    PublicDiscountsController,
  ],
})
export class PublicApiModule {}
