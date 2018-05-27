const Sequelize = require("sequelize");
const {models} = require("../models");

// Autoload the quiz with id equals to :quizId
exports.load = (req, res, next, quizId) => {

    models.quiz.findById(quizId)
    .then(quiz => {
        if (quiz) {
            req.quiz = quiz;
            next();
        } else {
            throw new Error('There is no quiz with id=' + quizId);
        }
    })
    .catch(error => next(error));
};


// GET /quizzes
exports.index = (req, res, next) => {

    models.quiz.findAll()
    .then(quizzes => {
        res.render('quizzes/index.ejs', {quizzes});
    })
    .catch(error => next(error));
};


// GET /quizzes/:quizId
exports.show = (req, res, next) => {

    const {quiz} = req;

    res.render('quizzes/show', {quiz});
};


// GET /quizzes/new
exports.new = (req, res, next) => {

    const quiz = {
        question: "", 
        answer: ""
    };

    res.render('quizzes/new', {quiz});
};

// POST /quizzes/create
exports.create = (req, res, next) => {

    const {question, answer} = req.body;

    const quiz = models.quiz.build({
        question,
        answer
    });

    // Saves only the fields question and answer into the DDBB
    quiz.save({fields: ["question", "answer"]})
    .then(quiz => {
        req.flash('success', 'Quiz created successfully.');
        res.redirect('/quizzes/' + quiz.id);
    })
    .catch(Sequelize.ValidationError, error => {
        req.flash('error', 'There are errors in the form:');
        error.errors.forEach(({message}) => req.flash('error', message));
        res.render('quizzes/new', {quiz});
    })
    .catch(error => {
        req.flash('error', 'Error creating a new Quiz: ' + error.message);
        next(error);
    });
};


// GET /quizzes/:quizId/edit
exports.edit = (req, res, next) => {

    const {quiz} = req;

    res.render('quizzes/edit', {quiz});
};


// PUT /quizzes/:quizId
exports.update = (req, res, next) => {

    const {quiz, body} = req;

    quiz.question = body.question;
    quiz.answer = body.answer;

    quiz.save({fields: ["question", "answer"]})
    .then(quiz => {
        req.flash('success', 'Quiz edited successfully.');
        res.redirect('/quizzes/' + quiz.id);
    })
    .catch(Sequelize.ValidationError, error => {
        req.flash('error', 'There are errors in the form:');
        error.errors.forEach(({message}) => req.flash('error', message));
        res.render('quizzes/edit', {quiz});
    })
    .catch(error => {
        req.flash('error', 'Error editing the Quiz: ' + error.message);
        next(error);
    });
};


// DELETE /quizzes/:quizId
exports.destroy = (req, res, next) => {

    req.quiz.destroy()
    .then(() => {
        req.flash('success', 'Quiz deleted successfully.');
        res.redirect('/quizzes');
    })
    .catch(error => {
        req.flash('error', 'Error deleting the Quiz: ' + error.message);
        next(error);
    });
};


// GET /quizzes/:quizId/play
exports.play = (req, res, next) => {

    const {quiz, query} = req;

    const answer = query.answer || '';

    res.render('quizzes/play', {
        quiz,
        answer
    });
};


// GET /quizzes/:quizId/check
exports.check = (req, res, next) => {

    const {quiz, query} = req;

    const answer = query.answer || "";
    const result = answer.toLowerCase().trim() === quiz.answer.toLowerCase().trim();

    res.render('quizzes/result', {
        quiz,
        result,
        answer
    });
};


/*
* randomplay muestra una pregunta al azar en el formulario del view random_play
*
* Para ello:
*
* 1) Se crea un array con las ids preguntas de la BBDD.
* 2) Se consulta la BBDD y se saca los ids de las que faltan por contestar.
* 3) Se pasa el quiz al formulario
*
 */
// GET /quizzes/randomplay
exports.randomplay = (req, res, next) => {


    // 1) Se crea un array con las ids preguntas de la BBDD.
    req.session.randomPlay = req.session.randomPlay || [];

    const score0 = req.session.randomPlay.length;

// 2) Se consulta la BBDD y se saca los ids de las que faltan por contestar.
    const whereOpt = {'id': {[Sequelize.Op.notIn]: req.session.randomPlay}};
    models.quiz.count({where: whereOpt})
        .then(function (count) {
            return models.quiz.findAll({
                where: whereOpt,
                offset: Math.floor(Math.random() * count),
                limit: 1
            })
        })
        // 3) Se pasa el quiz al formulario
        .then(function (quizzes) {

            if(quizzes[0]) {
                res.render('quizzes/random_play', { //Index random cehck tal
                    quiz: quizzes[0],
                    score: req.session.randomPlay.length
                })
            } else{
                req.session.randomPlay = [];
                res.render('quizzes/random_nomore', { //Index random cehck tal
                    score: score0
                })

            }

        })
        .catch(error => next(error))
};


/*
* randomcheck muestra si la respuesta es correcta en el formulario.
*
* 1) Comprueba si la respuesta que obtiene de la BBDD guardada en req.query
* es la misma de la que aparece en el formulario.
* 2) Si es correcto se sigue jugando hasta que se acaben las preguntas.
* 3) Si es incorrecto se muestra el view random_nomore
*
*/
// GET /quizzes/:quizId/randomcheck
exports.randomcheck = (req, res, next) => {

    // 1) Comprueba si la respuesta que obtiene de la BBDD guardada en req.query
    // es la misma de la que aparece en el formulario.
    const answer = req.query.answer || "";
    const result  = answer.toLowerCase().trim() === req.quiz.answer.toLowerCase().trim() ;

    if (result){
        req.session.randomPlay.push(req.quiz.id);
    }
    //else{
    //  delete req.session.randomPlay;
    //}

    const score = req.session.randomPlay.length;
    console.log(">>>>>>>>>>", score);
    res.render('quizzes/random_result', {answer, result, score});

    if (!result){
        delete req.session.randomPlay;
    }
};
