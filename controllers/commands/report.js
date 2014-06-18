var util = require('util'),
    moment = require('moment-timezone'),
    epi = require('epi-week'),
    request = require('request'),
    Reporter = require('../../models/Reporter'),
    Survey = require('../../models/Survey'),
    SurveyResponse = require('../../models/SurveyResponse');

var MESSAGES = {
    noSurveyFound: 'No survey found for this phone number.',
    registerFirst: 'This phone number has not yet been registered - text the "register" command to sign up.',
    questions: '[MSF]: Please enter the following data for %s in %s:',
    numericInputRequired: 'Error: numeric input required for %s.',
    confirm: 'About to submit the following data for %s in %s:\n%s \nText "confirm <any comments>" to confirm and submit this data.',
    generalError: 'Sorry, there was a problem with the system.  Please try again.'
};

// Handle a command to create a new report 
exports.report = function(number, message, surveyId, callback) {
    var survey, reporter;
    // Defaults to current epi week, need to make this configurable
    var interval = epi(moment().tz('Africa/Lagos').toDate());

    // Determine which survey, reporter we're working with...
    // TODO: also determine which place we're currently reporting for, currently
    // hard coded for the first place associated with a user
    Survey.findById(surveyId, function(err, doc) {
        if (err || !doc) {
            console.log(err);
            callback(err, MESSAGES.noSurveyFound);
        } else {
            survey = doc;
            // Now find the reporter
            Reporter.findOne({
                phoneNumbers: number
            }, function(err, rep) {
                if (!rep) {
                    callback(err, MESSAGES.registerFirst);
                } else {
                    console.log('[' + number + '] found reporter: ' + rep._id);
                    reporter = rep;
                    processInput();
                }
            });
        }
    });

    // print out survey questions
    function printSurvey() {
        var dataList = survey.questions.map(function(question) {
            return question.summaryText;
        });
        var baseMessage = util.format(
            MESSAGES.questions,
            reporter.placeIds[0],
            'Epi Week '+interval.week+' ('+interval.year+')'
        );
        return baseMessage + '\n' + dataList.join(',\n');
    }

    // print out question responses
    function printResponses(questions, responses) {
        var str = '';
        for (var i = 0; i < responses.length; i++) {
            var q = questions[i], r = responses[i];
            var tr = r.textResponse;
            if (q.responseType === 'number' && r.numberResponse === null) {
                tr = 'Unknown';
            }
            str = str + q.summaryText + ': ' + tr +'\n';
        }
        return str;
    }

    // process user command input
    function processInput() {

        // Attempt to grab responses from a comma separated list
        var answerInputs = message.split(',');
        if (answerInputs.length === survey.questions.length) {
            // try to use these answers for the actual report
            var responses = [];
            for (var i = 0; i<answerInputs.length; i++) {
                var answerText = answerInputs[i].trim(),
                    question = survey.questions[i];

                if (question.responseType === 'number') {
                    var casted = Number(answerText);
                    if (answerText.toUpperCase() === 'U') {
                        // let users enter "u" to mean "unknown"
                        casted = null;
                    }
                    if (!isNaN(casted)) {
                        responses.push({
                            _questionId: question._id,
                            textResponse: answerText,
                            numberResponse: casted  // a number or null
                        });
                    } else {
                        callback(null, util.format(
                            MESSAGES.numericInputRequired,
                            question.summaryText
                        )+' '+printSurvey());
                        return;
                    }
                } else {
                    // for now throw everything else in as just text
                    responses.push({
                        _questionId: question._id,
                        textResponse: answerText
                    });
                }
            }

            // Now that we have answers processed, create a survey response
            createSurveyResponse(responses);

        } else {
            // otherwise, print out current questions
            callback(null, printSurvey());
        }
    }

    // With current data collected, create and save a SurveyResponse
    function createSurveyResponse(responses) {
        var sr;

        // Create new or update pending response
        SurveyResponse.findOne({
            _surveyId: surveyId,
            _reporterId: reporter._id,
            placeId: reporter.placeIds[0],
            interval: interval
        }, function(err, doc) {
            if (doc) {
                console.log()
                sr = doc;
                updateResponse();
            } else {
                sr = new SurveyResponse({
                    _surveyId: surveyId,
                    _reporterId: reporter._id,
                    placeId: reporter.placeIds[0],
                    interval: interval
                });
                updateResponse();
            }
        });

        // Update response with inputs
        function updateResponse() {
            sr.phoneNumber = number;
            sr.complete = false;
            sr.commentText = '';
            sr.responses = responses;
            sr.save(function(err) {
                if (err) {
                    console.log(err);
                    callback(err, MESSAGES.generalError);
                } else {
                    var msg = util.format(
                        MESSAGES.confirm,
                        reporter.placeIds[0],
                        'Epi Week '+interval.week+' ('+interval.year+')',
                        printResponses(survey.questions, responses)
                    );
                    callback(null, msg);
                }
            });
        }
    }
};
