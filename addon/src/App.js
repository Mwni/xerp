import c from '@corethrill/core'
import Wallet from './ui/Wallet.jsc'
import Unlock from './ui/Unlock.jsc'
import NewWallet from './ui/NewWallet.jsc'
import CreateWallet from './ui/CreateWallet.jsc'
import ImportWallet from './ui/ImportWallet.jsc'
import SetPasscode from './ui/SetPasscode.jsc'
import ConfirmPasscode from './ui/ConfirmPasscode.jsc'


export default class{
	constructor(container){
		this.init(container)
	}

	async init(container){
		this.state = await this.query({type: 'get-appstate'}) || {}

		console.log(JSON.stringify(this.state))

		c.route(container, '/new', {
			'/new': {view: node => c(NewWallet, {ctx: this})},
			'/new/create': {view: node => c(CreateWallet, {ctx: this})},
			'/new/import': {view: node => c(ImportWallet, {ctx: this})},
			'/new/passcode': {view: node => c(SetPasscode, {ctx: this})},
			'/new/passcode/confirm': {view: node => c(ConfirmPasscode, {ctx: this})},
			'/unlock': {view: node => c(Unlock, {ctx: this})},
			'/wallet': {view: node => c(Wallet, {ctx: this})},
			'/wallet/:section': {view: node => c(Wallet, {ctx: this, section: node.attrs.section})},
		})

		if(this.state.route){
			c.route.set(this.state.route)
		}else{
			if(await this.query({type: 'has-wallets'}))
				c.route.set('/unlock')
		}

		//wish I wouldn't have to do it this way, but I have no choice
		setInterval(() => this.syncState(), 100)
	}

	async addWallet(data){
		await this.query({type: 'add-wallet', ...data})
		await this.unlock(data.passcode)
	}

	async unlock(passcode){
		this.state.wallets = await this.query({type: 'get-wallets', passcode})
		this.state.passcode = passcode
		this.state.account = this.state.wallets[0]

		return true
	}

	async requireBalances(){
		if(!this.account.balances){
			this.account.balances = await this.query({type: 'get-balances', address: this.account.address})
			this.redraw()
		}
	}

	getGroupedBalances(){
		let groups = []

		for(let balance of this.account.balances){
			let group = groups.find(group => group[0].currency === balance.currency)

			if(!group){
				group = [balance]
				groups.push(group)
			}

			group.push(balance)
		}

		return groups
	}

	get account(){
		return this.state.account
	}

	redraw(){
		c.redraw()
	}

	goto(route){
		c.route.set(route)
	}

	pstate(key){
		if(key === 'route')
			throw 'reserved key'

		this.syncState()

		if(this.state[key])
			return this.state[key]

		return this.state[key] = {}
	}

	syncState(){
		this.state.route = c.route.get()
		this.query({type: 'set-appstate', state: this.state})
	}

	async deriveAddress(seed){
		return await this.query({type: 'derive-address', seed})
	}

	async getXrpBalance(address){
		return await this.query({type: 'get-xrp-balance', address})
	}

	async query(payload){
		return await new Promise((resolve, reject) => {
			chrome.extension.sendMessage(payload, response => {
				if(!response){
					reject(new Error('Internal error'))
					return
				}


				if(response.success)
					resolve(response.payload)
				else
					reject(response.error)
			})
		})
	}
}