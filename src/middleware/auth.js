const isAdmin = (req, res, next) => {
    // TODO: Implement proper admin authentication
    // For now, using a simple API key check
    const apiKey = req.headers['x-api-key'];
    
    if (!apiKey || apiKey !== process.env.ADMIN_API_KEY) {
        return res.status(401).json({ 
            success: false, 
            message: 'Unauthorized. Invalid or missing API key.' 
        });
    }

    next();
};

module.exports = {
    isAdmin
};
