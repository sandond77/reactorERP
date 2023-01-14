# reactorERP
Reactor is a web-browser enterprise resource planning system built with react and mysql(through Sequelize ORM). 

### What is an enterprise resource planning(ERP)?
Enterprise resource planning (ERP) refers to a type of software that organizations use to manage day-to-day business activities such as accounting, procurement, project management, risk management and compliance, and supply chain operations.

### Basic Features to Implement
1. Inventory Management 
    - Items are assigned an internal part numbers and batch numbers
    - Items will have information their manufacturers' data tracked (manufacturer's name, manufacturer's lot/batch number, date of manufacture, expiry date, cost, quantity) 
    - All items will live in virtual locations (Rooms, shelves, etc)
2. Transaction Management
    - Inventory usage is managed through transactions
    - Users will be able to consume/transact inventory under a purchase order(PO)
    - ERP will provide a summary of the transacted materials. This summary will include information such as the quantity and cost of goods.

### Future Features Roadmap (no specific order)
- User Roles
    - Different users will have varying access levels
        - Viewer/Auditor (can only view transaction history)
        - Basic Transactor (can view transaction history and will be able to run transactions)
        - Admin/Manager (will be able to view transactions, run and reverse transactions, add new items to inventory)
- Threshold Alerts
    - Restock Alerts will be provided once an item is under a threshold
- Cycle Counting
    - Cycle counting a function used to verify inventory levels. Users will be required to count and take inventory of all items in a specific location.
    - System will compare to entered count vs the system's and it will generate a discrepency percentage

#### Coding Roadmap
- Create node express backend + react base code
- Create mySQL database and schemas
    - 1 location = 1 database
        - Information to be tracked
            - Manufacturer
            - Manufacturer's Part Number
                - Gets assigned corresponding internal part number
                - Items from the same manufacturer with the same manufacturer's batch number will share an internal batch number
            - Manufacturer's Lot/batch number
            - Date of Manufacture
            - Expiry Date
            - Date Received
            - Cost per Item
            - Unit of Quantity (how many come per order. Ex: 1 Case of 24 bottles, etc...)
    - Schema for Transactions
        - Transactions will track:
            - Internal Part Number
            - Internal Batch Number
            - Quantity Consumed
            - Date and Time of Transaction 

- React Frontend
    - Navbar
    - Pages for:
        - Charging
        - Receiving
        - Inventory Summary