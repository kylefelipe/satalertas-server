const DashboardService = require(__dirname + '/../services/dashboard.service');
const {response} = require("../utils/response");
const httpStatus = require('../enum/http-status');

exports.getAnalysis = async (req, res, next) => {
    try {
        const analysis = await DashboardService.getAnalysis(req.query)
        res.json(response(httpStatus.SUCCESS, analysis));
    } catch (e) {
        next(e)
    }
};

exports.getAnalysisCharts = async (req, res, next) => {
    try {
        const analysisCharts = await DashboardService.getAnalysisCharts(req.query);
        res.json(response(httpStatus.SUCCESS, analysisCharts));
    } catch (e) {
        next(e)
    }
};
