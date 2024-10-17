const jwt = require('jsonwebtoken')

const auth = (req, res, next) => {
	const token = (req.headers["authorization"] || req.headers["Authorization"])?.split(' ')[1]
	if(token) {
		jwt.verify(token, process.env.JWT_SECRET_KEY || 'JWT_SECRET_KEY', async function(err, decoded) {
			if(!err && decoded.exp*1000 > +new Date) {

				req.user = decoded

				req.user.isAdmin = req.user.role == 'Admin'

				next()
			} else {
				res.status(401).json({message:"Invalid Auth"})
			}
		});

	} else {
		res.status(401).json({message:"No Auth"})
	}
}

const generate = (data, expiry = 1 * 60 * 60) => {
	return jwt.sign(data, process.env.JWT_SECRET_KEY || 'JWT_SECRET_KEY', { expiresIn: expiry });
}

const generateRefresh = (data, expiry = 15 * 24 * 60 * 60) => {
	return jwt.sign(data, process.env.REFRESH_JWT_SECRET_KEY || 'REFRESH_JWT_SECRET_KEY', { expiresIn: expiry });
}

const decode = (token) => {
	return jwt.verify(token, process.env.JWT_SECRET_KEY || 'JWT_SECRET_KEY');
}

const decodeRefresh = (token) => {
	return jwt.verify(token, process.env.REFRESH_JWT_SECRET_KEY || 'REFRESH_JWT_SECRET_KEY');
}

const checkRole = (roles, clientOnlyRoute) => (req, res, next) => {

	if (typeof(clientOnlyRoute) == 'boolean') {
		if (clientOnlyRoute && !req.user.client_id)
			return res.status(401).json({ msg: 'This feature is available to Charger managers only' });
	}

	// console.log(req.user.role, req.user.role.includes(roles),typeof(roles),roles.includes(req.user.role), roles)

	if (Array.isArray(roles)) {
		if (!roles.includes(req.user.role))
			return res.status(401).json({ msg: `This action is not permitted for the account role ` });
	}
	// General role type check (user/admin etc.)
	else if (typeof(roles) == 'string') {
		if (!req.user.role.includes(roles))
			return res.status(401).json({ msg: `This action is not permitted for the account role ` });
	}

	next()

}

module.exports = { auth, generate, decode, checkRole, generateRefresh, decodeRefresh}