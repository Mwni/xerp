# XERP Wallet
The XRP wallet for your browser with third-party capabilities. This project is in early alpha. If you want to try the add-on yourself, read below.

## How to install the alpha version

 1. Download this repo
 2. Open the extensions tab on Chrome
 3. Enable developer mode
 4. Drop the `addon/chrome` folder into the extensions tab
 5. The addon is now installed an accessible on the top right of your browser

## How to build it yourself
You will need

 - Node v12+
 - Npm
 - Rollup CLI

Rollup CLI can be obtained by running
```
npm install --global rollup
```
Open a terminal with the working directory set to this repository

 1. Switch to the addon directory using `cd addon`
 2. Install package dependencies: `npm install`
 3. Run `rollup --config`
 4. The built add-on is now at `addon/chrome`, to install, follow the steps above
## To-do overview
This is only an approximate overview with the planned key features
 - [x] Add-on framework
 - [x] Secure wallet store
 - [x] Import wallet
 - [x] Balances
 - [x] Chrome support
 - [ ] Create new wallet
 - [ ] Transaction history
 - [ ] Trustline management
 - [ ] Key export
 - [ ] Key import
 - [ ] Payments
 - [ ] Third-party API
 - [ ] Firefox support
 - [ ] Opera support
 - [ ] Edge support
 - [ ] Safari support
